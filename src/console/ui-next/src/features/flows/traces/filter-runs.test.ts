/**
 * Unit tests for Traces client-side filters.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { EMPTY_DIMENSION_QUERY, parseDimensionQuery } from "./dimension-query.ts";
import { durationThresholdLabel, filterScopedRuns, type TracesFilters } from "./filter-runs.ts";

function run(partial: Partial<RunRow> & Pick<RunRow, "id" | "flow" | "durationMs">): RunRow {
  return {
    parentId: null,
    unit: null,
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    inputTokens: null,
    outputTokens: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1,
    endedAt: 2,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    input: null,
    output: null,
    ...partial,
  };
}

const base: Pick<TracesFilters, "advanced" | "query"> = {
  advanced: EMPTY_DIMENSION_QUERY,
  query: "",
};

describe("filterScopedRuns", () => {
  const rows = [
    run({ id: "ok-fast", flow: "a", durationMs: 5, error: null }),
    run({ id: "ok-mid", flow: "a", durationMs: 56, error: null, trigger: "signal" }),
    run({ id: "err-slow", flow: "b", durationMs: 1_200, error: "Timeout", cache: "miss" }),
  ];

  test("all + no threshold returns every row", () => {
    const filters: TracesFilters = { status: "all", minDurationMs: null, ...base };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual([
      "ok-fast",
      "ok-mid",
      "err-slow",
    ]);
  });

  test("errors-only keeps failed runs", () => {
    const filters: TracesFilters = { status: "errors", minDurationMs: null, ...base };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual(["err-slow"]);
  });

  test("duration threshold keeps runs strictly above the cutoff", () => {
    expect(
      filterScopedRuns(rows, { status: "all", minDurationMs: 10, ...base }).map((r) => r.id),
    ).toEqual(["ok-mid", "err-slow"]);
    expect(
      filterScopedRuns(rows, { status: "all", minDurationMs: 100, ...base }).map((r) => r.id),
    ).toEqual(["err-slow"]);
    expect(
      filterScopedRuns(rows, { status: "all", minDurationMs: 1_000, ...base }).map((r) => r.id),
    ).toEqual(["err-slow"]);
  });

  test("status and duration compose", () => {
    expect(
      filterScopedRuns(rows, { status: "errors", minDurationMs: 1_000, ...base }).map((r) => r.id),
    ).toEqual(["err-slow"]);
    const aboveAll = rows.map((r) => ({ ...r, durationMs: 50 }));
    expect(
      filterScopedRuns(aboveAll, { status: "errors", minDurationMs: 100, ...base }).map(
        (r) => r.id,
      ),
    ).toEqual([]);
  });

  test("advanced dimension query composes with basic filters", () => {
    const filters: TracesFilters = {
      ...base,
      status: "all",
      minDurationMs: 10,
      advanced: parseDimensionQuery("trigger = signal"),
    };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual(["ok-mid"]);
  });

  test("free-text query matches flow, trigger, cache, and error", () => {
    expect(
      filterScopedRuns(rows, { status: "all", minDurationMs: null, ...base, query: "b" }).map(
        (r) => r.id,
      ),
    ).toEqual(["err-slow"]);
    expect(
      filterScopedRuns(rows, {
        status: "all",
        minDurationMs: null,
        ...base,
        query: "signal",
      }).map((r) => r.id),
    ).toEqual(["ok-mid"]);
    expect(
      filterScopedRuns(rows, { status: "all", minDurationMs: null, ...base, query: "miss" }).map(
        (r) => r.id,
      ),
    ).toEqual(["err-slow"]);
    expect(
      filterScopedRuns(rows, {
        status: "all",
        minDurationMs: null,
        ...base,
        query: "timeout",
      }).map((r) => r.id),
    ).toEqual(["err-slow"]);
  });
});

describe("durationThresholdLabel", () => {
  test("labels presets", () => {
    expect(durationThresholdLabel(null)).toBe("Any duration");
    expect(durationThresholdLabel(10)).toBe("> 10ms");
    expect(durationThresholdLabel(25)).toBe("> 25ms");
    expect(durationThresholdLabel(50)).toBe("> 50ms");
    expect(durationThresholdLabel(100)).toBe("> 100ms");
    expect(durationThresholdLabel(250)).toBe("> 250ms");
    expect(durationThresholdLabel(500)).toBe("> 500ms");
    expect(durationThresholdLabel(1_000)).toBe("> 1s");
    expect(durationThresholdLabel(5_000)).toBe("> 5s");
  });
});
