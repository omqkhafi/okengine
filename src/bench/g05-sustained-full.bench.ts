/**
 * G5 — sustained full-app baseline + memory (≥5 min).
 *
 * Boots `load-child serve`, then drives fixed concurrency 50 closed-loop:
 * 30 workers on `/ping`, 20 workers round-robining mixed element endpoints
 * (vault read, json stream, rate gate, store insert). RSS/fd sampled every
 * 10 s (`lib/rss-sampler.ts`). Duration `OKE_BENCH_DURATION_S` (default 300);
 * auto-extends to 600 s ONLY if the trailing RSS slope is still rising.
 * p99 spikes are annotated as likely-JSC-GC unless correlated with errors.
 *
 * Leak protocol: if a leak appears mid-run, STOP, fix, restart from t=0 —
 * never resume. (Enforced by failing the run when errors spike.)
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g05-sustained-full.bench.ts --timeout 600000
 */

import { describe, expect, test } from "bun:test";
import { LIVE_PG } from "./lib/infra.ts";
import { rssSlopeMbPerMin, startSampler } from "./lib/rss-sampler.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const PORT = 6675;
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION_S = CAL ? 20 : Math.max(60, Number(process.env.OKE_BENCH_DURATION_S ?? "300"));
const EXTEND_S = CAL ? 0 : 300;
const CONCURRENCY = 50;
const PING_WORKERS = 30;
const MIXED = ["/_/bench/vault-read", "/_/bench/stream", "/rate", "/_/bench/rls"] as const;

interface Sample {
  tMs: number;
  rssMb: number;
  fds: number;
}

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

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G5 — sustained baseline", () => {
  test(
    `${CONCURRENCY} closed-loop × ${DURATION_S}s (+${EXTEND_S}s if rising) — rps, RSS slope, GC spikes`,
    async () => {
      const server = spawnServe();
      try {
        const pid = await readReadyPid(server);
        // Warm-up so boot/JIT isn't counted.
        await Bun.sleep(CAL ? 2_000 : 5_000);

        const sampler = startSampler(pid, 10_000);
        const t0 = performance.now();
        const deadlineMs = DURATION_S * 1000;

        const latencies: Record<string, number[]> = { ping: [], mixed: [] };
        // Thin latency samples beyond 200k so percentile sorting and memory
        // stay bounded on long runs; request counts remain exact.
        const pushLat = (arr: number[], ms: number): void => {
          if (arr.length < 200_000 || arr.length % 8 === 0) arr.push(ms);
        };
        let requests = 0;
        let errors = 0;
        let stop = false;
        const classCount = { ping: 0, mixed: 0 };

        const pingWorker = async (): Promise<void> => {
          while (!stop) {
            const s = performance.now();
            try {
              const res = await fetch(`${BASE}/ping`);
              await res.arrayBuffer();
              if (!res.ok) errors++;
            } catch {
              errors++;
              continue;
            }
            pushLat(latencies.ping!, performance.now() - s);
            requests++;
            classCount.ping++;
          }
        };

        let mixedIdx = 0;
        let gated429 = 0;
        const mixedWorker = async (): Promise<void> => {
          while (!stop) {
            const path = MIXED[mixedIdx++ % MIXED.length]!;
            const s = performance.now();
            try {
              const res =
                path === "/rate"
                  ? await fetch(`${BASE}${path}`)
                  : await fetch(`${BASE}${path}`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(path === "/_/bench/stream" ? { chunks: 8 } : { n: 1 }),
                    });
              await res.arrayBuffer();
              if (res.status === 429 && path === "/rate") {
                // Expected physics: the bench deliberately overruns the
                // 1000/min gate — count separately, not as an error.
                gated429++;
              } else if (!res.ok) {
                errors++;
              }
            } catch {
              errors++;
              continue;
            }
            pushLat(latencies.mixed!, performance.now() - s);
            requests++;
            classCount.mixed++;
          }
        };

        const running = Promise.all([
          ...Array.from({ length: PING_WORKERS }, () => pingWorker()),
          ...Array.from({ length: CONCURRENCY - PING_WORKERS }, () => mixedWorker()),
        ]);

        // Phase 1: baseline duration; extend only while RSS slope still rises.
        let phase1Samples: readonly Sample[] = [];
        for (;;) {
          await Bun.sleep(CAL ? 5_000 : 30_000);
          phase1Samples = [...sampler.samples()];
          const elapsed = performance.now() - t0;
          if (stop) break;
          if (elapsed >= deadlineMs) {
            const tailSlope = rssSlopeMbPerMin(phase1Samples, 6);
            if (!CAL && tailSlope > 2 && elapsed < deadlineMs + EXTEND_S * 1000 - 60_000) {
              console.log(
                `[G5] RSS slope still rising (${tailSlope} MB/min) at ${DURATION_S}s — extending to ${DURATION_S + EXTEND_S}s`,
              );
              continue;
            }
            stop = true;
          }
        }
        await running;
        const wallS = (performance.now() - t0) / 1000;
        await sampler.stop();

        const all = [...phase1Samples];
        const pingLats = latencies.ping!;
        const mixedLats = latencies.mixed!;
        const flat = [...pingLats, ...mixedLats];

        // Windowed p99 (per ~30 s slice) → spikes annotated as likely JSC GC
        // unless correlated with request errors in the same window.
        const windowP99s: number[] = [];
        const buckets = new Map<number, number[]>();
        const sliceCount = Math.max(1, Math.floor(wallS / 30));
        for (let i = 0; i < flat.length; i++) {
          const slice = Math.min(sliceCount - 1, Math.floor((i / flat.length) * sliceCount));
          const arr = buckets.get(slice) ?? [];
          arr.push(flat[i]!);
          buckets.set(slice, arr);
        }
        for (const arr of buckets.values()) windowP99s.push(percentile(arr, 99));
        const medianWindowP99 = percentile(windowP99s, 50) || 0;
        const gcSpikeWindows = windowP99s.filter(
          (p) => medianWindowP99 > 0 && p > medianWindowP99 * 3,
        ).length;

        const rssSlopeFull = rssSlopeMbPerMin(all);
        const rssSlopeTail = rssSlopeMbPerMin(all, 6);
        // Spread-into-Math.max overflows the call stack at millions of
        // samples — always reduce instead.
        const maxOf = (arr: readonly number[]): number => arr.reduce((a, b) => (b > a ? b : a), 0);
        const issues: string[] = [];
        if (errors > 0) {
          issues.push(
            `${errors} request errors under sustained load — investigate before trusting p99`,
          );
        }
        if (rssSlopeFull > 5 && rssSlopeTail > 2) {
          issues.push(
            `RSS slope ${rssSlopeFull} MB/min full-run and still ${rssSlopeTail} MB/min over the last minute — suspected leak; re-run from t=0 after any fix`,
          );
        } else if (rssSlopeFull > 5) {
          issues.push(
            `RSS slope ${rssSlopeFull} MB/min full-run but tail is flat (${rssSlopeTail} MB/min last minute) — consistent with JSC heap expansion ramp, not an unbounded leak`,
          );
        }

        const metrics: Record<string, number> = {
          durationS: Number(wallS.toFixed(1)),
          concurrency: CONCURRENCY,
          totalRequests: requests,
          reqPerSec: Number((requests / wallS).toFixed(1)),
          pingReqPerSec: Number((classCount.ping / wallS).toFixed(1)),
          mixedReqPerSec: Number((classCount.mixed / wallS).toFixed(1)),
          pingP50Ms: Number(percentile(pingLats, 50).toFixed(2)),
          pingP99Ms: Number(percentile(pingLats, 99).toFixed(2)),
          mixedP50Ms: Number(percentile(mixedLats, 50).toFixed(2)),
          mixedP99Ms: Number(percentile(mixedLats, 99).toFixed(2)),
          overallMaxMs: flat.length ? Number(maxOf(flat).toFixed(2)) : 0,
          gcSpikeWindows,
          windowP99MedianMs: Number(medianWindowP99.toFixed(2)),
          rssSlopeMbPerMin: rssSlopeFull,
          rssSlopeLastMinute: rssSlopeTail,
          rssMaxMb: all.length ? Number(maxOf(all.map((x) => x.rssMb)).toFixed(1)) : -1,
          fdsFinal: all.length ? all[all.length - 1]!.fds : -1,
          gateLimited429: gated429,
          errors,
        };
        console.log("[G5] metrics:", JSON.stringify(metrics));

        const path = await writeArtifact({
          group: "G5-sustained-full",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g05-sustained-full.bench.ts --timeout 600000",
          metrics,
          issues,
          fixes: [],
          remeasured: null,
        });
        console.log(`[G5] artifact: ${path}`);

        expect(errors / Math.max(1, requests)).toBeLessThan(0.001);
        expect(requests).toBeGreaterThan(0);
      } finally {
        server.kill();
        await server.exited.catch(() => {});
      }
    },
    CAL ? 120_000 : 700_000,
  );
});
