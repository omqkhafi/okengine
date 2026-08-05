import { describe, expect, test } from "bun:test";
import {
  errorPatterns,
  failedRunsInWindow,
  filterRunsSince,
  parseSinceWindowMs,
} from "./errors.ts";
import { RUNS_CHAIN_FIXTURE } from "./fixture.ts";
import type { RunRecord } from "./types.ts";

function withTime(run: RunRecord, startedAt: number, error: string | null): RunRecord {
  return {
    ...run,
    startedAt,
    endedAt: startedAt + run.durationMs,
    error,
    dimensions: { ...run.dimensions, error_code: error },
  };
}

describe("error patterns", () => {
  test("parseSinceWindowMs accepts durations and epoch ms", () => {
    expect(parseSinceWindowMs("1h")).toBe(3_600_000);
    expect(parseSinceWindowMs("5m")).toBe(300_000);
    expect(parseSinceWindowMs("3600000")).toBe(3_600_000);
    expect(parseSinceWindowMs("nope")).toBeUndefined();
  });

  test("aggregates error codes in the last hour", () => {
    const now = 1_000_000;
    const base = RUNS_CHAIN_FIXTURE[0]!;
    const runs: RunRecord[] = [
      withTime(base, now - 10_000, "FlightFull"),
      withTime(base, now - 20_000, "FlightFull"),
      withTime(base, now - 30_000, "Timeout"),
      withTime(base, now - 2 * 3_600_000, "FlightFull"), // outside window
      withTime(base, now - 5_000, null),
    ];
    const patterns = errorPatterns(runs, now, 3_600_000);
    expect(patterns.map((p) => [p.key, p.count])).toEqual([
      ["FlightFull", 2],
      ["Timeout", 1],
    ]);
    expect(failedRunsInWindow(runs, now, 3_600_000)).toHaveLength(3);
  });

  test("filterRunsSince keeps only recent runs", () => {
    const now = 1_000_000;
    const base = RUNS_CHAIN_FIXTURE[0]!;
    const runs = [withTime(base, now - 100, null), withTime(base, now - 10_000, null)];
    expect(filterRunsSince(runs, now - 1_000)).toHaveLength(1);
  });
});
