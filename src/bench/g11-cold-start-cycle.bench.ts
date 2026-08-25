/**
 * G11 — cold start cycle: 100 consecutive fresh `Bun.spawn(["bun","-e",probe])`
 * cycles following `measureColdStartMedianMsOnce`
 * (`src/release/measure.ts`) — every cycle is a brand-new Bun process, so no
 * module cache is shared across cycles.
 *
 * Reported:
 *   - two windows: cycles 1–10 (cold-ish) vs 91–100 (OS-warm) medians;
 *   - parent-process RSS slope over all cycles (leak watch);
 *   - interpretation rules baked into the artifact:
 *       rising 91–100 slope      → suspected leak (issue);
 *       drop across windows      → expected OS warmup, not a win.
 *
 * Run: OKE_BENCH=1 bun test ./src/bench/g11-cold-start-cycle.bench.ts --timeout 300000
 */

import { describe, expect, test } from "bun:test";
import { LIVE_PG } from "./lib/infra.ts";
import {
  DISCLAIMER,
  HARDWARE,
  percentile,
  writeArtifact,
  type BenchArtifact,
} from "./lib/report.ts";

const ROOT = `${import.meta.dir}/../..`;
const CYCLES = Math.max(20, Number(process.env.OKE_BENCH_G11_CYCLES ?? "100"));

/** Identical probe body to measureColdStartMedianMsOnce (src/release/measure.ts). */
const PROBE = `
const t0 = performance.now();
const { createBunRuntime, oke, on, flow, http } = await import(${JSON.stringify(`${ROOT}/src/http.ts`)});
const { resetBindings } = await import(${JSON.stringify(`${ROOT}/src/kernel/on.ts`)});
resetBindings();
on(http.get("/ping").public(), flow("ping", { do: () => ({ ok: true }) }));
const app = oke({ name: "cold-start" });
const rt = createBunRuntime();
const server = rt.serve(app, { port: 0, hostname: "127.0.0.1" });
const ms = performance.now() - t0;
server.stop(true);
process.stdout.write(String(ms));
`;

interface CycleSample {
  readonly i: number;
  readonly coldMs: number;
  readonly parentRssMb: number;
}

function leastSquaresSlope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i]!, 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
}

describe.skipIf(!process.env.OKE_BENCH)("G11 — cold start cycle", () => {
  test(
    `${CYCLES} fresh Bun.spawn cycles — two-window medians + parent RSS slope`,
    async () => {
      const samples: CycleSample[] = [];
      for (let i = 1; i <= CYCLES; i++) {
        const proc = Bun.spawn(["bun", "-e", PROBE], {
          cwd: ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) throw new Error(`cycle ${i} probe failed: ${stderr || stdout}`);
        const ms = Number(stdout.trim());
        if (!Number.isFinite(ms) || ms <= 0) {
          throw new Error(`cycle ${i} returned non-numeric: ${stdout}`);
        }
        samples.push({
          i,
          coldMs: ms,
          parentRssMb: process.memoryUsage.rss() / 1024 / 1024,
        });
        if (i % 25 === 0) console.log(`[G11] cycle ${i}/${CYCLES}: ${ms.toFixed(1)}ms`);
      }

      const all = samples.map((s) => s.coldMs);
      const w1 = samples.slice(0, 10).map((s) => s.coldMs);
      const w2 = samples.slice(-10).map((s) => s.coldMs);

      // Slopes: ms per cycle within the last window, and MB per cycle for RSS.
      const tail = samples.slice(-10);
      const tailCycleSlopePerCycle = leastSquaresSlope(
        tail.map((s) => s.i),
        tail.map((s) => s.coldMs),
      );
      const rssSlopePerCycleAll = leastSquaresSlope(
        samples.map((s) => s.i),
        samples.map((s) => s.parentRssMb),
      );

      const metrics: Record<string, number> = {
        cycles: CYCLES,
        window1_p50Ms: Number(percentile(w1, 50).toFixed(3)),
        window1_p99Ms: Number(percentile(w1, 99).toFixed(3)),
        window2_p50Ms: Number(percentile(w2, 50).toFixed(3)),
        window2_p99Ms: Number(percentile(w2, 99).toFixed(3)),
        overallP50Ms: Number(percentile(all, 50).toFixed(3)),
        overallP99Ms: Number(percentile(all, 99).toFixed(3)),
        overallMinMs: Number(Math.min(...all).toFixed(3)),
        overallMaxMs: Number(Math.max(...all).toFixed(3)),
        window2MinusWindow1P50Ms: Number(
          (percentile(w2, 50) - percentile(w1, 50)).toFixed(3),
        ),
        window2CycleSlopeMsPerCycle: Number(tailCycleSlopePerCycle.toFixed(4)),
        parentRssStartMb: Number(samples[0]!.parentRssMb.toFixed(1)),
        parentRssEndMb: Number(samples.at(-1)!.parentRssMb.toFixed(1)),
        parentRssSlopeMbPerCycle: Number(rssSlopePerCycleAll.toFixed(4)),
        parentRssGrowthMb: Number(
          (samples.at(-1)!.parentRssMb - samples[0]!.parentRssMb).toFixed(1),
        ),
      };

      // Interpretation rules baked into the artifact.
      const issues: string[] = [];
      const notes: string[] = [];
      if (
        metrics.window2CycleSlopeMsPerCycle! > 2 &&
        percentile(w2, 50) > percentile(w1, 50)
      ) {
        issues.push(
          `suspected leak: cycles 91-100 trend rising at ${metrics.window2CycleSlopeMsPerCycle}ms/cycle ` +
            `and warm window p50 (${metrics.window2_p50Ms}ms) exceeds cold window p50 ` +
            `(${metrics.window1_p50Ms}ms)`,
        );
      }
      if (metrics.parentRssSlopeMbPerCycle! > 0.5) {
        issues.push(
          `parent RSS climbing at ${metrics.parentRssSlopeMbPerCycle}MB/cycle ` +
            `(+${metrics.parentRssGrowthMb}MB over run)`,
        );
      }
      if (issues.length === 0 && metrics.window2MinusWindow1P50Ms! < 0) {
        notes.push(
          "warm-window p50 below cold-window p50 — expected OS/FS cache warmup across 100 spawns, not a real improvement",
        );
      }

      const artifact: BenchArtifact = {
        group: "G11-cold-start-cycle",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 bun test ./src/bench/g11-cold-start-cycle.bench.ts --timeout 300000",
        metrics,
        issues: [...notes.map((n) => `note: ${n}`), ...issues],
        fixes: [],
        remeasured: null,
      };
      console.log("[G11] metrics:", JSON.stringify(metrics));
      if (artifact.issues.length > 0) console.log("[G11] issues:", artifact.issues);
      const path = await writeArtifact(artifact);
      console.log(`[G11] artifact: ${path}`);

      expect(CYCLES).toBeGreaterThanOrEqual(100);
      expect(metrics.overallP50Ms!).toBeGreaterThan(0);
    },
    300_000,
  );
});

// G11 is pure subprocess work — live infra import kept only for gate symmetry.
void LIVE_PG;
