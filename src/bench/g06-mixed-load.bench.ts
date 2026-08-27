/**
 * G6 — mixed load + event-loop lag on a single child.
 *
 * One `load-child serve` process, driven concurrently by:
 *   - HTTP flood (20 closed-loop workers on `/ping`)
 *   - once-signal emit (8 workers on `/_/bench/emit`) + periodic drain
 *   - live-signal emits (8 workers on `/_/bench/emit-live`) fanned out to
 *     ≥50 in-process SSE subscribers whose received frames are counted
 *   - the child's internal clock tick loop (20 ms) under all of the above
 *
 * Reports per-subsystem throughput compared against the newest G5 artifact
 * (cross-contention delta) plus harness-side `measureEventLoopLag()` p99.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g06-mixed-load.bench.ts --timeout 300000
 */

import { describe, expect, test } from "bun:test";
import { LIVE_PG } from "./lib/infra.ts";
import { measureEventLoopLag } from "./lib/event-loop-lag.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const PORT = 6676;
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION_S = CAL ? 15 : Math.max(30, Number(process.env.OKE_BENCH_G6_S ?? "60"));
const SSE_SUBSCRIBERS = 50;
const PING_WORKERS = 20;
const EMIT_WORKERS = 8;
const LIVE_WORKERS = 8;

type Server = Bun.Subprocess<"ignore", "pipe", "ignore">;

function spawnServe(): Server {
  return Bun.spawn(["bun", "run", "src/bench/load-child.ts", "serve", String(PORT)], {
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  });
}

async function readReadyPid(proc: Server): Promise<number> {
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("server died before ready");
    buf += dec.decode(value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      if (line.startsWith("{")) {
        void (async () => {
          try {
            for (;;) {
              const r = await reader.read();
              if (r.done) break;
            }
          } catch {
            /* closed */
          }
        })();
        return (JSON.parse(line) as { pid: number }).pid;
      }
    }
  }
}

/** SSE subscriber that counts received data frames until aborted. */
async function sseSubscriber(
  target: string,
  ac: AbortController,
  onFrame: () => void,
): Promise<void> {
  while (!ac.signal.aborted) {
    try {
      const res = await fetch(target, {
        signal: ac.signal,
        headers: { accept: "text/event-stream" },
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep = buf.indexOf("\n\n");
        while (sep >= 0) {
          if (buf.slice(0, sep).includes("data:")) onFrame();
          buf = buf.slice(sep + 2);
          sep = buf.indexOf("\n\n");
        }
      }
    } catch {
      if (ac.signal.aborted) return;
    }
    await Bun.sleep(100); // reconnect briefly if dropped
  }
}

/** Newest G5 artifact metrics for cross-contention comparison. */
async function latestG5(): Promise<Record<string, number> | null> {
  try {
    const proc = Bun.spawnSync([
      "sh",
      "-c",
      "ls -t src/bench/results/G5-*.json 2>/dev/null | head -1",
    ]);
    const file = proc.stdout.toString().trim();
    if (!file) return null;
    return JSON.parse(await Bun.file(file).text()).metrics as Record<string, number>;
  } catch {
    return null;
  }
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G6 — mixed load contention", () => {
  test(
    `HTTP flood + emit/drain + live SSE(${SSE_SUBSCRIBERS}) + clock tick × ${DURATION_S}s`,
    async () => {
      const server = spawnServe();
      try {
        await readReadyPid(server);
        await Bun.sleep(CAL ? 2_000 : 4_000); // warm-up

        const lag = measureEventLoopLag(100);
        const target = `${BASE}/_oke/live/bench-live`;
        let sseFrames = 0;
        const sseCtrl = new AbortController();
        const subscribers = Array.from({ length: SSE_SUBSCRIBERS }, () =>
          sseSubscriber(target, sseCtrl, () => sseFrames++),
        );
        // Let every subscriber connect before load starts.
        await Bun.sleep(3_000);

        const t0 = performance.now();
        let stop = false;
        const counters = { ping: 0, emit: 0, live: 0, drain: 0, errors: 0 };
        const pingLats: number[] = [];
        const emitLats: number[] = [];
        const liveEmitLats: number[] = [];

        const loop = async (
          path: string,
          counter: keyof typeof counters,
          lats?: number[],
        ): Promise<void> => {
          while (!stop) {
            const s = performance.now();
            try {
              const res =
                path === "/ping"
                  ? await fetch(`${BASE}${path}`)
                  : await fetch(`${BASE}${path}`, { method: "POST" });
              await res.arrayBuffer();
              if (!res.ok) counters.errors++;
            } catch {
              counters.errors++;
              continue;
            }
            lats?.push(performance.now() - s);
            counters[counter]++;
          }
        };

        const pingWorkers = Array.from({ length: PING_WORKERS }, () =>
          loop("/ping", "ping", pingLats),
        );
        const emitWorkers = Array.from({ length: EMIT_WORKERS }, () =>
          loop("/_/bench/emit", "emit", emitLats),
        );
        const liveWorkers = Array.from({ length: LIVE_WORKERS }, () =>
          loop("/_/bench/emit-live", "live", liveEmitLats),
        );

        // Periodic explicit drain calls alongside the child's internal drain.
        const drainLoop = (async () => {
          while (!stop) {
            try {
              const res = await fetch(`${BASE}/_/bench/drain`, { method: "POST" });
              await res.arrayBuffer();
              if (res.ok) counters.drain++;
            } catch {
              counters.errors++;
            }
            await Bun.sleep(50);
          }
        })();

        await Bun.sleep(DURATION_S * 1000);
        stop = true;
        await Promise.all([...pingWorkers, ...emitWorkers, ...liveWorkers, drainLoop]);
        sseCtrl.abort();
        await Promise.race([Promise.all(subscribers), Bun.sleep(5_000)]);
        lag.stop();

        const wallS = (performance.now() - t0) / 1000;
        const g5 = await latestG5();

        const lags = lag.lags();
        const metrics: Record<string, number> = {
          durationS: Number(wallS.toFixed(1)),
          pingReqPerSec: Number((counters.ping / wallS).toFixed(1)),
          emitPerSec: Number((counters.emit / wallS).toFixed(1)),
          liveEmitPerSec: Number((counters.live / wallS).toFixed(1)),
          drainsPerSec: Number((counters.drain / wallS).toFixed(1)),
          sseFramesReceived: sseFrames,
          sseDeliveredPerSec: Number((sseFrames / wallS).toFixed(1)),
          errors: counters.errors,
          lagP50Ms: Number(percentile(lags, 50).toFixed(2)),
          lagP99Ms: Number(percentile(lags, 99).toFixed(2)),
          lagMaxMs: lags.length ? Number(Math.max(...lags).toFixed(2)) : 0,
        };
        if (g5) {
          const g5Ping = g5.pingReqPerSec ?? -1;
          metrics.g5BaselinePingRps = g5Ping;
          metrics.pingDeltaVsG5Pct =
            g5Ping > 0
              ? Number(((((metrics.pingReqPerSec ?? 0) - g5Ping) / g5Ping) * 100).toFixed(1))
              : -1;
        }

        const issues: string[] = [];
        if ((metrics.errors ?? 0) > 0) {
          issues.push(`${metrics.errors} request errors under mixed load`);
        }
        if (g5 && metrics.pingDeltaVsG5Pct! < -40) {
          issues.push(
            `ping throughput fell ${Math.abs(metrics.pingDeltaVsG5Pct!)}% vs G5 baseline under cross-subsystem contention`,
          );
        }

        console.log("[G6] metrics:", JSON.stringify(metrics));
        const path = await writeArtifact({
          group: "G6-mixed-load",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g06-mixed-load.bench.ts --timeout 300000",
          metrics,
          issues,
          fixes: [],
          remeasured: null,
        });
        console.log(`[G6] artifact: ${path}`);

        expect(
          (metrics.errors ?? 0) / Math.max(1, counters.ping + counters.emit + counters.live),
        ).toBeLessThan(0.001);
        expect(metrics.sseFramesReceived).toBeGreaterThan(0);
      } finally {
        server.kill();
        await server.exited.catch(() => {});
      }
    },
    CAL ? 120_000 : 240_000,
  );
});
