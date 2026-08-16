/**
 * Flow activity summary — honest empty when buffer has nothing in-window.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { flowActivitySummary } from "./flow-activity.ts";

function run(partial: Partial<RunRow> & Pick<RunRow, "id" | "flow" | "startedAt">): RunRow {
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
    endedAt: partial.startedAt + 1,
    durationMs: 1,
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

describe("flowActivitySummary", () => {
  test("empty buffer → honest empty (not zero-as-fake-data)", () => {
    expect(flowActivitySummary([], "bookings.create", 1_000_000)).toEqual({ kind: "empty" });
  });

  test("other flows only → honest empty for this flow", () => {
    const runs = [run({ id: "a", flow: "other.flow", startedAt: 999_000 })];
    expect(flowActivitySummary(runs, "bookings.create", 1_000_000)).toEqual({ kind: "empty" });
  });

  test("in-window runs → real call count + error rate", () => {
    const now = 1_000_000;
    const windowMs = 60_000;
    const runs = [
      run({ id: "new", flow: "bookings.create", startedAt: now - 1_000, error: "FlightFull" }),
      run({ id: "ok", flow: "bookings.create", startedAt: now - 2_000 }),
      run({ id: "old", flow: "bookings.create", startedAt: now - 120_000 }),
      run({ id: "noise", flow: "other.flow", startedAt: now - 500 }),
    ];
    const summary = flowActivitySummary(runs, "bookings.create", now, windowMs);
    expect(summary).toEqual({
      kind: "summary",
      calls: 2,
      errors: 1,
      errorRate: 0.5,
      lastStartedAt: now - 1_000,
      latestRunId: "new",
      windowMs,
    });
  });

  test("all matching runs outside window → honest empty", () => {
    const now = 1_000_000;
    const runs = [run({ id: "stale", flow: "bookings.create", startedAt: now - 3_600_000 })];
    expect(flowActivitySummary(runs, "bookings.create", now, 60_000)).toEqual({ kind: "empty" });
  });
});
