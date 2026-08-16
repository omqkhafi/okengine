/**
 * Time-bucketed series from the Console runs buffer (no DuckDB round-trip).
 */

import type { RunRow } from "@/client.ts";
import { percentile, runFailed, runsInWindow } from "./window-stats.ts";

/** One time bucket. */
export type TimeBucket = {
  readonly startAt: number;
  readonly n: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly p95Ms: number;
  readonly requestPerSec: number;
};

/** Honest empty — no in-window rows to chart. */
export type TimeSeriesEmpty = {
  readonly kind: "empty";
};

/** Bucketed series. */
export type TimeSeries = {
  readonly kind: "series";
  readonly buckets: readonly TimeBucket[];
  readonly bucketMs: number;
  readonly windowMs: number;
};

/** Time-series projection. */
export type TimeBuckets = TimeSeriesEmpty | TimeSeries;

/** One composed-chart row — request volume, error count, P95. */
export type ObservabilityChartRow = {
  readonly date: Date;
  readonly requests: number;
  readonly errors: number;
  readonly p95: number;
};

/**
 * Project buckets onto the Bklit composed-chart data shape.
 *
 * @param buckets - In-window time buckets
 */
export function composedSeriesFromBuckets(buckets: readonly TimeBucket[]): ObservabilityChartRow[] {
  return buckets.map((bucket) => ({
    date: new Date(bucket.startAt),
    requests: bucket.n,
    errors: bucket.errors,
    p95: bucket.p95Ms,
  }));
}

/**
 * Bucket width for a lookback — denser windows get finer buckets.
 *
 * @param windowMs - Lookback
 */
export function bucketMsForWindow(windowMs: number): number {
  if (windowMs <= 60 * 60_000) return 60_000;
  if (windowMs <= 24 * 60 * 60_000) return 5 * 60_000;
  return 60 * 60_000;
}

/**
 * Floor epoch-ms to a bucket start.
 *
 * @param startedAt - Run start
 * @param bucketMs - Bucket width
 */
export function floorToBucket(startedAt: number, bucketMs: number): number {
  return Math.floor(startedAt / bucketMs) * bucketMs;
}

/**
 * Bucket in-window runs for request rate / error rate / P95.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function timeBuckets(runs: readonly RunRow[], nowMs: number, windowMs: number): TimeBuckets {
  const inWindow = runsInWindow(runs, nowMs, windowMs);
  if (inWindow.length === 0) return { kind: "empty" };

  const bucketMs = bucketMsForWindow(windowMs);
  const from = nowMs - Math.max(0, windowMs);
  const first = floorToBucket(from, bucketMs);
  const last = floorToBucket(nowMs, bucketMs);

  const durations = new Map<number, number[]>();
  const counts = new Map<number, { n: number; errors: number }>();
  for (let t = first; t <= last; t += bucketMs) {
    durations.set(t, []);
    counts.set(t, { n: 0, errors: 0 });
  }

  for (const run of inWindow) {
    const start = floorToBucket(run.startedAt, bucketMs);
    const dur = durations.get(start);
    const count = counts.get(start);
    if (!dur || !count) continue;
    dur.push(run.durationMs);
    count.n += 1;
    if (runFailed(run)) count.errors += 1;
  }

  const buckets: TimeBucket[] = [];
  for (let t = first; t <= last; t += bucketMs) {
    const dur = durations.get(t) ?? [];
    const count = counts.get(t) ?? { n: 0, errors: 0 };
    const sorted = [...dur].sort((a, b) => a - b);
    buckets.push({
      startAt: t,
      n: count.n,
      errors: count.errors,
      errorRate: count.n === 0 ? 0 : count.errors / count.n,
      p95Ms: count.n === 0 ? 0 : percentile(sorted, 0.95),
      requestPerSec: count.n / (bucketMs / 1000),
    });
  }

  return { kind: "series", buckets, bucketMs, windowMs };
}
