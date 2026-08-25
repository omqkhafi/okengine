/**
 * G3b — SSE subscriber memory + fd growth, with the G12 doctor-fd re-verify.
 *
 * Boots `load-child serve`, attaches 100 SSE subscribers via
 * `load-child flood-sse`, holds, scales to 500 total, and samples RSS + open
 * fds every 5 s for ≥60 s (`lib/rss-sampler.ts`). Cross-checks G12's
 * `estimatePeakFds` per-subscriber constant against observed server-side fd
 * growth; a >20% delta is recorded in `issues` (and fixed in
 * `src/cli/doctor-fd.ts`).
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g03-signal-sse-memory.bench.ts --timeout 240000
 */

import { describe, expect, test } from "bun:test";
import { estimatePeakFds, FD_COST_PER_SUBSCRIBER } from "../cli/doctor-fd.ts";
import { LIVE_PG, waitFor } from "./lib/infra.ts";
import { rssSlopeMbPerMin, startSampler } from "./lib/rss-sampler.ts";
import { DISCLAIMER, HARDWARE, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const PORT = 6671;
const BASE = `http://127.0.0.1:${PORT}`;
const SIGNAL = "bench-live";
const FIRST_WAVE = 100;
const SECOND_WAVE = 400;
const HOLD_MS = CAL ? 8_000 : 30_000;

interface Ready {
  ready: boolean;
  pid: number;
  port: number;
}

type Server = Bun.Subprocess<"ignore", "pipe", "pipe">;

function spawnChild(args: string[]): Server {
  return Bun.spawn(["bun", "run", "src/bench/load-child.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
}

/** Read the first JSON stdout line (the ready line), then keep draining. */
async function readReady(proc: Server): Promise<Ready> {
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("child exited before ready line");
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
        return JSON.parse(line) as Ready;
      }
    }
  }
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G3b — SSE memory + fd growth", () => {
  test(
    `${FIRST_WAVE}→${FIRST_WAVE + SECOND_WAVE} SSE subs — RSS/fd sampling + G12 fd cross-check`,
    async () => {
      const server = spawnChild(["serve", String(PORT)]);
      let serverPid = -1;
      let flood1: Server | undefined;
      let flood2: Server | undefined;
      try {
        const ready = await readReady(server);
        serverPid = ready.pid;
        expect(ready.ready).toBe(true);

        const sampler = startSampler(serverPid, 5_000);
        await Bun.sleep(3_000); // settle baseline

        // Wave 1: 100 subscribers.
        flood1 = spawnChild(["flood-sse", BASE, SIGNAL, String(FIRST_WAVE)]);
        const ok100 = await waitFor(async () => countSse(serverPid) >= FIRST_WAVE, 30_000);
        await Bun.sleep(HOLD_MS / 2);
        const fdsAt100 = avgFds(sampler.samples());

        // Wave 2: scale to 500 total.
        flood2 = spawnChild(["flood-sse", BASE, SIGNAL, String(SECOND_WAVE)]);
        const ok500 = await waitFor(
          async () => countSse(serverPid) >= FIRST_WAVE + SECOND_WAVE - 5,
          60_000,
        );
        await Bun.sleep(HOLD_MS);

        const all = [...sampler.samples()];
        const rssSlope = rssSlopeMbPerMin(all);
        const fdsAt500 = avgFds(all, 4);
        const addedSubs = SECOND_WAVE;
        const observed = Math.max(0, (fdsAt500 - fdsAt100) / addedSubs);

        await sampler.stop();

        // G12 cross-check: compare the formula's per-subscriber fd constant
        // against observed server-side fd growth per added subscriber.
        const baseNoManifest = estimatePeakFds(null);
        const g12PerSub = FD_COST_PER_SUBSCRIBER;

        const denom = observed < 0.05 ? 0.05 : observed;
        const deltaPct = Number((((g12PerSub - denom) / denom) * 100).toFixed(1));

        const issues: string[] = [];
        if (!ok100) issues.push(`wave-1 did not reach ${FIRST_WAVE} concurrent SSE (server side)`);
        if (!ok500) {
          issues.push(`wave-2 did not reach ~${FIRST_WAVE + SECOND_WAVE} concurrent SSE`);
        }
        if (Math.abs(deltaPct) > 20) {
          issues.push(
            `G12 fd cross-check OFF: estimatePeakFds budgets ${g12PerSub} fds/subscriber, observed ${observed.toFixed(2)} (delta ${deltaPct}%) — constants need reconciliation`,
          );
        }

        const metrics: Record<string, number> = {
          targetSubscribers: FIRST_WAVE + SECOND_WAVE,
          fdsAt100Avg: Number(fdsAt100.toFixed(1)),
          fdsAt500Avg: Number(fdsAt500.toFixed(1)),
          fdsPerSubscriberObserved: Number(observed.toFixed(2)),
          g12EstimateFdsPerSubscriber: g12PerSub,
          g12DeltaPct: deltaPct,
          g12EstimatedNeedNoManifest: baseNoManifest,
          rssSlopeMbPerMinFullRun: rssSlope,
          rssMaxMb: Number(Math.max(...all.map((s) => s.rssMb)).toFixed(1)),
          samples: all.length,
        };
        console.log("[G3b] metrics:", JSON.stringify(metrics));

        const path = await writeArtifact({
          group: "G3b-signal-sse-memory",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g03-signal-sse-memory.bench.ts --timeout 240000",
          metrics,
          issues,
          fixes: [],
          remeasured: null,
        });
        console.log(`[G3b] artifact: ${path}`);

        expect(all.length).toBeGreaterThanOrEqual(CAL ? 3 : 10);
        expect(fdsAt500).toBeGreaterThan(fdsAt100);
      } finally {
        flood1?.kill();
        flood2?.kill();
        server.kill();
        await server.exited.catch(() => {});
      }

      expect(serverPid).toBeGreaterThan(0);
    },
    CAL ? 90_000 : 200_000,
  );
});

/** Established TCP connections to the bench port held by the server pid. */
function countSse(pid: number): number {
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

/** Average open-fd count over the most recent `n` non-zero samples. */
function avgFds(samples: readonly { fds: number }[], n = 4): number {
  const win = samples.slice(-n).filter((s) => s.fds > 0);
  if (win.length === 0) return 0;
  return win.reduce((a, s) => a + s.fds, 0) / win.length;
}
