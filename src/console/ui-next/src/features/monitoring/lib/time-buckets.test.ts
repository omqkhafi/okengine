/**
 * Time buckets — empty when the window has no rows.
 */

import { describe, expect, test } from "bun:test";
import { monitoringRun } from "./run-fixture.ts";
import {
  bucketMsForWindow,
  composedSeriesFromBuckets,
  floorToBucket,
  timeBuckets,
} from "./time-buckets.ts";

describe("bucketMsForWindow", () => {
  test("picks finer buckets for shorter windows", () => {
    expect(bucketMsForWindow(15 * 60_000)).toBe(60_000);
    expect(bucketMsForWindow(24 * 60 * 60_000)).toBe(5 * 60_000);
    expect(bucketMsForWindow(7 * 24 * 60 * 60_000)).toBe(60 * 60_000);
  });
});

describe("timeBuckets", () => {
  test("empty buffer → honest empty", () => {
    expect(timeBuckets([], 1_000_000, 60_000)).toEqual({ kind: "empty" });
  });

  test("counts a run into its floored minute and fills the window", () => {
    const now = 180_000;
    const startedAt = 121_000;
    const runs = [
      monitoringRun({
        id: "a",
        flow: "x",
        startedAt,
        durationMs: 20,
        error: "Boom",
      }),
    ];
    const series = timeBuckets(runs, now, 60_000);
    expect(series.kind).toBe("series");
    if (series.kind !== "series") return;
    expect(series.bucketMs).toBe(60_000);
    const hit = series.buckets.find((b) => b.startAt === floorToBucket(startedAt, 60_000));
    expect(hit).toMatchObject({ n: 1, errors: 1, errorRate: 1, p95Ms: 20 });
    expect(series.buckets.length).toBeGreaterThan(0);
  });

  test("composedSeriesFromBuckets keeps request / error / P95 honest", () => {
    const rows = composedSeriesFromBuckets([
      {
        startAt: 120_000,
        n: 4,
        errors: 1,
        errorRate: 0.25,
        p95Ms: 40,
        requestPerSec: 4 / 60,
      },
    ]);
    expect(rows).toEqual([{ date: new Date(120_000), requests: 4, errors: 1, p95: 40 }]);
  });
});
