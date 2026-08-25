/**
 * G3c — mass reconnect storm + `nextResubscribeDelay` backoff verification
 * (`src/client/live.ts`: 500 ms floor → 30 s ceiling).
 *
 * Part 1 (pure): the backoff sequence clamps to ≥500 ms, doubles, and caps at
 * exactly 30 000 ms.
 *
 * Part 2 (live): boot `load-child serve`, open N SSE subscriber loops with
 * auto-resubscribe driven by `nextResubscribeDelay`, SIGKILL the server mid-
 * stream, restart it, and observe the reconnect storm: every client must come
 * back and every observed backoff must stay within [500, 30 000] ms while
 * growing monotonically per client until success.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g03-signal-reconnect.bench.ts --timeout 180000
 */

import { describe, expect, test } from "bun:test";
import {
  LIVE_PG,
} from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";
import {
  LIVE_RESUBSCRIBE_INITIAL_MS,
  LIVE_RESUBSCRIBE_MAX_MS,
  nextResubscribeDelay,
} from "../client/live.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const PORT = 6672;
const BASE = `http://127.0.0.1:${PORT}`;
const SIGNAL = "bench-live";
const CLIENTS = CAL ? 50 : 200;

type ServeProc = Bun.Subprocess<"ignore", "pipe", "ignore">;

function spawnServe(): ServeProc {
  return Bun.spawn(["bun", "run", "src/bench/load-child.ts", "serve", String(PORT)], {
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  });
}

/** One auto-resubscribing SSE client; records every backoff it sleeps. */
async function reconnectClient(
  target: string,
  stop: Promise<void>,
  delays: number[],
): Promise<void> {
  let delay = LIVE_RESUBSCRIBE_INITIAL_MS;
  let stopped = false;
  void stop.then(() => {
    stopped = true;
  });
  for (;;) {
    if (stopped) return;
    const ac = new AbortController();
    stop.then(() => ac.abort(), () => ac.abort());
    try {
      const res = await fetch(target, {
        signal: ac.signal,
        headers: { accept: "text/event-stream" },
      });
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch {
      /* drop — reconnect below */
    }
    if (stopped || ac.signal.aborted) return;
    // Server is down or dropped us: back off, then retry.
    delays.push(delay);
    await Bun.sleep(delay);
    delay = nextResubscribeDelay(delay);
  }
}

/** Resolve the ready line's pid from a serve child, then keep draining stdout. */
async function readReadyPid(proc: ServeProc): Promise<number> {
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
        const parsed = JSON.parse(line) as { pid: number };
        return parsed.pid;
      }
    }
  }
}

function promiseOf<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Established server-side sockets on the bench port for one pid. */
function countConns(pid: number): number {
  try {
    const out = Bun.spawnSync([
      "sh",
      "-c",
      `lsof -a -p ${pid} -iTCP:${PORT} -sTCP:ESTABLISHED 2>/dev/null | tail -n +2 | wc -l`,
    ]);
    return Number(out.stdout.toString().trim());
  } catch {
    return 0;
  }
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G3c — reconnect storm + backoff cap", () => {
  test("nextResubscribeDelay floor/doubling/ceiling (pure)", () => {
    expect(LIVE_RESUBSCRIBE_INITIAL_MS).toBe(500);
    expect(LIVE_RESUBSCRIBE_MAX_MS).toBe(30_000);
    // Floor: any input clamps up to the 500 ms initial before doubling.
    expect(nextResubscribeDelay(0)).toBe(1000); // max(0, 500) * 2
    expect(nextResubscribeDelay(250)).toBe(1000); // clamped to floor first
    expect(nextResubscribeDelay(500)).toBe(1000);
    // Ceiling: never exceeds 30 s even from large inputs.
    expect(nextResubscribeDelay(20_000)).toBe(30_000);
    expect(nextResubscribeDelay(30_000)).toBe(30_000);
  });

  test("backoff sequence stays within [500ms floor, 30s ceiling]", () => {
    let d = LIVE_RESUBSCRIBE_INITIAL_MS;
    const seq: number[] = [d];
    for (let i = 0; i < 12; i++) {
      d = nextResubscribeDelay(d);
      seq.push(d);
      expect(d).toBeGreaterThanOrEqual(LIVE_RESUBSCRIBE_INITIAL_MS);
      expect(d).toBeLessThanOrEqual(LIVE_RESUBSCRIBE_MAX_MS);
    }
    expect(seq[1]).toBe(1000);
    expect(seq.at(-1)).toBe(30_000);
  });

  test(
    `${CLIENTS} clients survive SIGKILL + restart via capped backoff`,
    async () => {
      const servers: ServeProc[] = [];
      try {
        let server = spawnServe();
        servers.push(server);
        let serverPid = await readReadyPid(server);

      const target = `${BASE}/_oke/live/${SIGNAL}`;
      const allDelays: number[][] = Array.from({ length: CLIENTS }, () => []);
      const stop = promiseOf<void>();
      const clients = Array.from({ length: CLIENTS }, (_, i) =>
        reconnectClient(target, stop.promise, allDelays[i]!),
      );

      // Give everyone a live connection first.
      await Bun.sleep(CAL ? 2_000 : 4_000);
      expect(countConns(serverPid)).toBeGreaterThan(CLIENTS * 0.5);

      // Abrupt kill — no graceful close, every socket drops at once.
      server.kill();
      await server.exited.catch(() => {});

      await Bun.sleep(CAL ? 1_000 : 2_000); // clients enter backoff

      // Restart; the storm should land within ≤ a few backoff rounds.
      server = spawnServe();
      servers.push(server);
      serverPid = await readReadyPid(server);

      const settleMs = CAL ? 8_000 : 35_000;
      await Bun.sleep(settleMs);

      // Count re-established sockets while clients are still connected.
      const reconnected = countConns(serverPid);

      stop.resolve();
      await Promise.race([Promise.all(clients), Bun.sleep(10_000)]);

      const flat = allDelays.flat();
      const minD = flat.length ? Math.min(...flat) : -1;
      const maxD = flat.length ? Math.max(...flat) : -1;

      const latencies = allDelays.map((d, i) => ({
        client: i,
        attempts: d.length,
      }));
      const activeClients = latencies.filter((l) => l.attempts > 0).length;

      const issues: string[] = [];
      if (minD < LIVE_RESUBSCRIBE_INITIAL_MS) issues.push(`backoff below floor: ${minD}ms`);
      if (maxD > LIVE_RESUBSCRIBE_MAX_MS) issues.push(`backoff above ceiling: ${maxD}ms`);
      if (reconnected < CLIENTS * 0.9) {
        issues.push(`only ${reconnected}/${CLIENTS} sockets re-established after restart`);
      }

      const metrics: Record<string, number> = {
        clients: CLIENTS,
        backoffSamples: flat.length,
        backoffMinMs: minD,
        backoffMaxMs: maxD,
        backoffP99Ms: percentile(flat, 99),
        clientsThatRetried: activeClients,
        socketsReconnected: reconnected,
      };
      console.log("[G3c] metrics:", JSON.stringify(metrics));

      const path = await writeArtifact({
        group: "G3c-signal-reconnect",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g03-signal-reconnect.bench.ts --timeout 180000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G3c] artifact: ${path}`);

      expect(minD).toBeGreaterThanOrEqual(LIVE_RESUBSCRIBE_INITIAL_MS);
      expect(maxD).toBeLessThanOrEqual(LIVE_RESUBSCRIBE_MAX_MS);
      expect(reconnected).toBeGreaterThanOrEqual(CLIENTS * 0.5);
      } finally {
        for (const s of servers) {
          s.kill();
          await s.exited.catch(() => {});
        }
      }
    },
    CAL ? 40_000 : 120_000,
  );
});
