/**
 * Unit tests for Traces dimension query (advanced filtering).
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import {
  filterByDimensionQuery,
  parseDimensionQuery,
  parseDurationMs,
  serializeDimensionQuery,
  toggleClause,
  upsertClause,
} from "./dimension-query.ts";

function run(partial: Partial<RunRow> & Pick<RunRow, "id" | "flow">): RunRow {
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

describe("dimension query", () => {
  test("parses flow = X AND cache = miss AND duration > 1s", () => {
    const q = parseDimensionQuery("flow = bookings.create AND cache = miss AND duration > 1s");
    expect(q.clauses).toEqual([
      { dimension: "flow", op: "=", value: "bookings.create" },
      { dimension: "cache", op: "=", value: "miss" },
      { dimension: "duration", op: ">", value: 1000 },
    ]);
    expect(serializeDimensionQuery(q)).toBe(
      "flow = bookings.create AND cache = miss AND duration > 1s",
    );
  });

  test("duration units ms / s / m", () => {
    expect(parseDurationMs("200ms")).toBe(200);
    expect(parseDurationMs("1s")).toBe(1000);
    expect(parseDurationMs("2m")).toBe(120_000);
    expect(parseDurationMs("50")).toBe(50);
  });

  test("filters by trigger and cache", () => {
    const rows = [
      run({ id: "a", flow: "bookings.create", trigger: "http", cache: "hit" }),
      run({ id: "b", flow: "fulfillment.onOrder", trigger: "signal", cache: "none" }),
      run({
        id: "c",
        flow: "bookings.create",
        trigger: "http",
        cache: "miss",
        error: "FlightFull",
      }),
    ];
    expect(
      filterByDimensionQuery(rows, parseDimensionQuery("trigger = signal")).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      filterByDimensionQuery(rows, parseDimensionQuery("cache = miss")).map((r) => r.id),
    ).toEqual(["c"]);
  });

  test("upsert replaces same dimension", () => {
    let q = parseDimensionQuery("cache = hit");
    q = upsertClause(q, { dimension: "cache", op: "=", value: "miss" });
    expect(serializeDimensionQuery(q)).toBe("cache = miss");
  });

  test("toggleClause adds then removes an exact clause", () => {
    const signal = { dimension: "trigger", op: "=" as const, value: "signal" };
    const added = toggleClause(parseDimensionQuery(""), signal);
    expect(serializeDimensionQuery(added)).toBe("trigger = signal");
    expect(serializeDimensionQuery(toggleClause(added, signal))).toBe("");
  });
});
