/**
 * parentId chain → flow ids for graph highlighting.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { chainFlowIds } from "./trace-chain.ts";

function run(
  partial: Partial<RunRow> & Pick<RunRow, "id" | "flow"> & { parentId?: string | null },
): RunRow {
  return {
    parentId: partial.parentId ?? null,
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
    startedAt: 1,
    endedAt: 2,
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

describe("chainFlowIds", () => {
  const runs = [
    run({ id: "root", flow: "bookings.create" }),
    run({ id: "child", flow: "fulfillment.onOrder", parentId: "root" }),
    run({ id: "other", flow: "bookings.mine" }),
  ];

  test("returns empty when nothing is selected", () => {
    expect([...chainFlowIds(runs, null)]).toEqual([]);
  });

  test("walks ancestors and descendants across parentId", () => {
    expect([...chainFlowIds(runs, "child")].sort()).toEqual([
      "bookings.create",
      "fulfillment.onOrder",
    ]);
    expect([...chainFlowIds(runs, "root")].sort()).toEqual([
      "bookings.create",
      "fulfillment.onOrder",
    ]);
  });

  test("isolates an unlinked run to its own flow", () => {
    expect([...chainFlowIds(runs, "other")]).toEqual(["bookings.mine"]);
  });
});
