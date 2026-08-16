/**
 * Unit tests for Traces client-side filters.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { EMPTY_DIMENSION_QUERY, parseDimensionQuery } from "./dimension-query.ts";
import { filterScopedRuns, type TracesFilters } from "./filter-runs.ts";

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

  test("all returns every row", () => {
    const filters: TracesFilters = { status: "all", ...base };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual([
      "ok-fast",
      "ok-mid",
      "err-slow",
    ]);
  });

  test("errors-only keeps failed runs", () => {
    const filters: TracesFilters = { status: "errors", ...base };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual(["err-slow"]);
  });

  test("advanced dimension query composes with basic filters", () => {
    const filters: TracesFilters = {
      ...base,
      status: "all",
      advanced: parseDimensionQuery("trigger = signal"),
    };
    expect(filterScopedRuns(rows, filters).map((r) => r.id)).toEqual(["ok-mid"]);
  });

  test("free-text query matches flow, trigger, cache, and error", () => {
    expect(filterScopedRuns(rows, { status: "all", ...base, query: "b" }).map((r) => r.id)).toEqual(
      ["err-slow"],
    );
    expect(
      filterScopedRuns(rows, {
        status: "all",
        ...base,
        query: "signal",
      }).map((r) => r.id),
    ).toEqual(["ok-mid"]);
    expect(
      filterScopedRuns(rows, { status: "all", ...base, query: "miss" }).map((r) => r.id),
    ).toEqual(["err-slow"]);
    expect(
      filterScopedRuns(rows, {
        status: "all",
        ...base,
        query: "timeout",
      }).map((r) => r.id),
    ).toEqual(["err-slow"]);
  });
});
