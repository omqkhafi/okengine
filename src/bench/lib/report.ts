/**
 * Bench artifact writer — every benchmark emits a uniform, disclaimer-stamped
 * JSON artifact into `src/bench/results/` (gitignored).
 *
 * These numbers are for regression trend analysis on this hardware — not
 * production SLA targets. macOS/Bun/JSC behavior differs from Linux prod.
 */

export interface BenchArtifact {
  readonly group: string;
  readonly hardware: string;
  readonly disclaimer: string;
  readonly command: string;
  readonly metrics: Record<string, number>;
  readonly issues: string[];
  readonly fixes: string[];
  readonly remeasured: null | { metrics: Record<string, number>; rerunScope?: string };
}

export const HARDWARE = "Apple M4, 24GB";

export const DISCLAIMER = "trend-analysis-only; not SLA; macOS M4 not Linux prod";

/** Percentile of an array of samples (ms or ops). */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

export function summarize(samples: number[]): {
  p50Ms: number;
  p99Ms: number;
  opsPerSec: number;
} {
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    p50Ms: Number(percentile(samples, 50).toFixed(3)),
    p99Ms: Number(percentile(samples, 99).toFixed(3)),
    opsPerSec: total > 0 ? Number((samples.length / (total / 1000)).toFixed(1)) : 0,
  };
}

/** Write `src/bench/results/<group>-<timestamp>.json`. */
export async function writeArtifact(a: BenchArtifact): Promise<string> {
  const dir = new URL("../results/", import.meta.url).pathname;
  await Bun.$`mkdir -p ${dir}`.quiet();
  const path = `${dir}${a.group}-${Date.now()}.json`;
  await Bun.write(path, `${JSON.stringify(a, null, 2)}\n`);
  return path;
}
