/**
 * Scope runs to flows present on the graph.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { scopeRunsToFlows } from "./scope-runs.ts";

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
    promptVersion: null,
    buildVersion: null,
    endedAt: partial.startedAt + 1,
    durationMs: 1,
    error: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    ...partial,
  };
}

describe("scopeRunsToFlows", () => {
  test("filters to visible Manifest flow ids and sorts newest first", () => {
    const runs = [
      run({ id: "old", flow: "bookings.create", startedAt: 10 }),
      run({ id: "new", flow: "bookings.create", startedAt: 30 }),
      run({ id: "noise", flow: "ghost.flow", startedAt: 40 }),
      run({ id: "mid", flow: "fulfillment.onOrder", startedAt: 20 }),
    ];
    const scoped = scopeRunsToFlows(
      runs,
      new Set(["bookings.create", "fulfillment.onOrder"]),
    );
    expect(scoped.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });
});
