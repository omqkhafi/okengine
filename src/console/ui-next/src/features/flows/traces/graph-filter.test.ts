/**
 * Unit tests for graph-driven Traces filtering.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { EMPTY_DIMENSION_QUERY } from "./dimension-query.ts";
import {
  applyGraphFilterToQuery,
  filterRunsByGraph,
  graphFilterForNodeId,
  matchesGraphFilter,
} from "./graph-filter.ts";

function sampleRun(partial: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    parentId: null,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1,
    endedAt: 13,
    durationMs: 12,
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

const MANIFEST: Manifest = {
  app: "skyport",
  flows: {
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
      effects: { emits: ["order-placed"] },
    },
    "fulfillment.onOrder": {
      trigger: { signal: "order-placed" },
      effects: { writes: ["sql:shipments"] },
    },
  },
} as unknown as Manifest;

describe("graphFilterForNodeId", () => {
  test("maps flow and signal node ids", () => {
    expect(graphFilterForNodeId("flow:bookings.create")).toEqual({
      kind: "flow",
      flowId: "bookings.create",
    });
    expect(graphFilterForNodeId("signal:order-placed")).toEqual({
      kind: "signal",
      signal: "order-placed",
    });
  });

  test("returns null for non-filterable node kinds", () => {
    expect(graphFilterForNodeId("store:sql:bookings")).toBeNull();
    expect(graphFilterForNodeId("ai:ticket-triage")).toBeNull();
    expect(graphFilterForNodeId("unit:bookings")).toBeNull();
  });
});

describe("applyGraphFilterToQuery", () => {
  test("upserts a flow clause", () => {
    const q = applyGraphFilterToQuery(EMPTY_DIMENSION_QUERY, {
      kind: "flow",
      flowId: "bookings.create",
    });
    expect(q.clauses).toEqual([{ dimension: "flow", op: "=", value: "bookings.create" }]);
  });

  test("leaves the query untouched for signal filters", () => {
    const q = applyGraphFilterToQuery(EMPTY_DIMENSION_QUERY, {
      kind: "signal",
      signal: "order-placed",
    });
    expect(q.clauses).toEqual([]);
  });
});

describe("matchesGraphFilter", () => {
  test("flow filter matches the run's own flow", () => {
    const run = sampleRun({ flow: "bookings.create" });
    expect(matchesGraphFilter(run, { kind: "flow", flowId: "bookings.create" }, MANIFEST)).toBe(
      true,
    );
    expect(matchesGraphFilter(run, { kind: "flow", flowId: "other.flow" }, MANIFEST)).toBe(false);
  });

  test("signal filter matches emitter and consumer flows", () => {
    const emitter = sampleRun({ flow: "bookings.create" });
    const consumer = sampleRun({ flow: "fulfillment.onOrder" });
    const unrelated = sampleRun({ flow: "ops.nightlyReconcile" });
    const filter = { kind: "signal" as const, signal: "order-placed" };
    expect(matchesGraphFilter(emitter, filter, MANIFEST)).toBe(true);
    expect(matchesGraphFilter(consumer, filter, MANIFEST)).toBe(true);
    expect(matchesGraphFilter(unrelated, filter, MANIFEST)).toBe(false);
  });
});

describe("filterRunsByGraph", () => {
  test("null filter returns the population", () => {
    const runs = [sampleRun({ id: "a" }), sampleRun({ id: "b" })];
    expect(filterRunsByGraph(runs, null, MANIFEST)).toHaveLength(2);
  });

  test("signal filter keeps only linked runs", () => {
    const runs = [
      sampleRun({ id: "a", flow: "bookings.create" }),
      sampleRun({ id: "b", flow: "fulfillment.onOrder" }),
      sampleRun({ id: "c", flow: "ops.nightlyReconcile" }),
    ];
    const out = filterRunsByGraph(runs, { kind: "signal", signal: "order-placed" }, MANIFEST);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
