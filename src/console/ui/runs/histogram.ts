/**
 * Duration distribution over the current filter (console §9.11).
 */

import type { DurationBucket, DurationRange, RunRecord } from "./types.ts";

/** Default bucket count for the histogram. */
export const DEFAULT_BUCKET_COUNT = 20;

/**
 * Build a duration histogram for the filtered population.
 *
 * @param runs - Filtered runs
 * @param bucketCount - Number of buckets (default 20)
 */
export function durationHistogram(
  runs: readonly RunRecord[],
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): DurationBucket[] {
  if (runs.length === 0 || bucketCount < 1) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const r of runs) {
    min = Math.min(min, r.durationMs);
    max = Math.max(max, r.durationMs);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    return [{ minMs: min, maxMs: max + 1, count: runs.length }];
  }

  const width = (max - min) / bucketCount;
  const buckets: DurationBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * width;
    const hi = i === bucketCount - 1 ? max + Number.EPSILON : min + (i + 1) * width;
    buckets.push({ minMs: lo, maxMs: hi, count: 0 });
  }

  for (const r of runs) {
    let idx = Math.floor((r.durationMs - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= bucketCount) idx = bucketCount - 1;
    const b = buckets[idx]!;
    buckets[idx] = { ...b, count: b.count + 1 };
  }

  return buckets;
}

/**
 * Whether a run falls inside an inclusive duration range.
 *
 * @param run - Run
 * @param range - Selected region
 */
export function inDurationRange(
  run: RunRecord,
  range: DurationRange,
): boolean {
  return run.durationMs >= range.minMs && run.durationMs <= range.maxMs;
}

/**
 * Normalise a brush selection against histogram bounds.
 *
 * @param a - First bound (ms)
 * @param b - Second bound (ms)
 */
export function normalizeRange(a: number, b: number): DurationRange {
  return a <= b ? { minMs: a, maxMs: b } : { minMs: b, maxMs: a };
}

/**
 * Format a duration for axis / chip labels.
 *
 * @param ms - Milliseconds
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2)}s`;
  return `${Math.round(ms)}ms`;
}
