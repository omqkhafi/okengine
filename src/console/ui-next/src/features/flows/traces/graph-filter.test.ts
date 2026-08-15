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
  graphFilterLabel,
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
  test("maps flow, signal, unit, element, and resource node ids", () => {
    expect(graphFilterForNodeId("flow:bookings.create")).toEqual({
      kind: "flow",
      flowId: "bookings.create",
    });
    expect(graphFilterForNodeId("signal:order-placed")).toEqual({
      kind: "signal",
      signal: "order-placed",
    });
    expect(graphFilterForNodeId("unit:bookings")).toEqual({ kind: "unit", unit: "bookings" });
    expect(graphFilterForNodeId("element:store")).toEqual({ kind: "element", element: "store" });
    expect(graphFilterForNodeId("type:store:sql")).toEqual({ kind: "element", element: "store" });
    expect(graphFilterForNodeId("type:store:kv")).toEqual({ kind: "element", element: "store" });
    expect(graphFilterForNodeId("kv:cache")).toEqual({
      kind: "resource",
      nodeId: "kv:cache",
    });
    expect(graphFilterForNodeId("type:flow:http")).toEqual({ kind: "element", element: "flow" });
    expect(graphFilterForNodeId("sql:bookings")).toEqual({
      kind: "resource",
      nodeId: "sql:bookings",
    });
    expect(graphFilterForNodeId("ai:ticket-triage")).toEqual({
      kind: "resource",
      nodeId: "ai:ticket-triage",
    });
  });

  test("returns null for unknown node kinds", () => {
    expect(graphFilterForNodeId("store:sql:bookings")).toBeNull();
    expect(graphFilterForNodeId("element:nope")).toBeNull();
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

  test("upserts a unit clause", () => {
    const q = applyGraphFilterToQuery(EMPTY_DIMENSION_QUERY, {
      kind: "unit",
      unit: "bookings",
    });
    expect(q.clauses).toEqual([{ dimension: "unit", op: "=", value: "bookings" }]);
  });

  test("leaves the query untouched for signal filters", () => {
    const q = applyGraphFilterToQuery(EMPTY_DIMENSION_QUERY, {
      kind: "signal",
      signal: "order-placed",
    });
    expect(q.clauses).toEqual([]);
  });
});

describe("graphFilterLabel", () => {
  test("names the chip from the filter kind", () => {
    expect(graphFilterLabel({ kind: "flow", flowId: "bookings.create" })).toBe("bookings.create");
    expect(graphFilterLabel({ kind: "element", element: "store" })).toBe("Store");
    expect(graphFilterLabel({ kind: "unit", unit: "bookings" })).toBe("bookings");
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

  test("unit filter matches the run unit", () => {
    const run = sampleRun({ unit: "bookings" });
    expect(matchesGraphFilter(run, { kind: "unit", unit: "bookings" }, MANIFEST)).toBe(true);
    expect(matchesGraphFilter(run, { kind: "unit", unit: "payments" }, MANIFEST)).toBe(false);
  });

  test("element filter matches ledger-touched elements", () => {
    const run = sampleRun({
      effects: [
        {
          kind: "write",
          resource: "sql:bookings",
          timestamp: 1,
          duration: 2,
          reversibility: "reversible",
        },
      ],
    });
    expect(matchesGraphFilter(run, { kind: "element", element: "store" }, MANIFEST)).toBe(true);
    expect(matchesGraphFilter(run, { kind: "element", element: "vault" }, MANIFEST)).toBe(false);
    expect(matchesGraphFilter(run, { kind: "element", element: "flow" }, MANIFEST)).toBe(true);
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
