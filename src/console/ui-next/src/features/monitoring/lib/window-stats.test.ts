/**
 * Window stats — honest empty when the buffer has nothing in-window.
 */

import { describe, expect, test } from "bun:test";
import { monitoringRun } from "./run-fixture.ts";
import { parseMonitoringWindow, percentile, windowStatsForRuns } from "./window-stats.ts";

describe("parseMonitoringWindow", () => {
  test("keeps known tokens and falls back", () => {
    expect(parseMonitoringWindow("7d")).toBe("7d");
    expect(parseMonitoringWindow("nope")).toBe("1h");
    expect(parseMonitoringWindow(undefined)).toBe("1h");
  });
});

describe("percentile", () => {
  test("matches nearest-rank on a sorted list", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
  });
});

describe("windowStatsForRuns", () => {
  test("empty buffer → honest empty", () => {
    expect(windowStatsForRuns([], 1_000_000, 60_000)).toEqual({ kind: "empty" });
  });

  test("all runs outside window → honest empty", () => {
    const runs = [monitoringRun({ id: "old", flow: "a", startedAt: 1_000 })];
    expect(windowStatsForRuns(runs, 1_000_000, 60_000)).toEqual({ kind: "empty" });
  });

  test("in-window runs → real totals and P95", () => {
    const now = 1_000_000;
    const runs = [
      monitoringRun({ id: "a", flow: "x", startedAt: now - 1_000, durationMs: 10 }),
      monitoringRun({
        id: "b",
        flow: "y",
        startedAt: now - 2_000,
        durationMs: 40,
        error: "Boom",
      }),
      monitoringRun({ id: "stale", flow: "x", startedAt: now - 120_000, durationMs: 999 }),
    ];
    const stats = windowStatsForRuns(runs, now, 60_000);
    expect(stats).toEqual({
      kind: "summary",
      total: 2,
      errors: 1,
      errorRate: 0.5,
      p50Ms: 10,
      p95Ms: 40,
      p99Ms: 40,
      from: now - 60_000,
      to: now,
      windowMs: 60_000,
    });
  });
});
