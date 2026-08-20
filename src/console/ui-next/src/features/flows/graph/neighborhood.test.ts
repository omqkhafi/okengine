/**
 * Neighborhood slice — detailed graph stays 1-hop.
 */

import { describe, expect, test } from "bun:test";
import { FLOWS_TEST_MANIFEST } from "../fixture.ts";
import { buildFlowGraph } from "./build-flow-graph.ts";
import { flowTouchesNode, sliceManifestForFocus } from "./neighborhood.ts";

describe("flowTouchesNode", () => {
  const create = FLOWS_TEST_MANIFEST.flows!["bookings.create"]!;
  const pay = FLOWS_TEST_MANIFEST.flows!["payments.chargeBooking"]!;

  test("matches declared effects and the flow itself", () => {
    expect(flowTouchesNode(create, "bookings.create", "flow:bookings.create")).toBe(true);
    expect(flowTouchesNode(create, "bookings.create", "sql:bookings")).toBe(true);
    expect(flowTouchesNode(create, "bookings.create", "signal:order-placed")).toBe(true);
    expect(flowTouchesNode(create, "bookings.create", "sql:shipments")).toBe(false);
    expect(flowTouchesNode(pay, "payments.chargeBooking", "vault:STRIPE_KEY")).toBe(true);
    expect(flowTouchesNode(pay, "payments.chargeBooking", "flow:bookings.create")).toBe(true);
  });
});

describe("sliceManifestForFocus", () => {
  test("unit focus keeps that unit plus callees", () => {
    const sliced = sliceManifestForFocus(FLOWS_TEST_MANIFEST, {
      kind: "unit",
      unit: "payments",
    });
    expect(Object.keys(sliced.flows ?? {}).sort()).toEqual([
      "bookings.create",
      "payments.chargeBooking",
    ]);
  });

  test("flow focus keeps the flow, callees, and callers", () => {
    const sliced = sliceManifestForFocus(FLOWS_TEST_MANIFEST, {
      kind: "flow",
      flowId: "bookings.create",
    });
    expect(Object.keys(sliced.flows ?? {}).sort()).toEqual([
      "bookings.create",
      "payments.chargeBooking",
    ]);
  });

  test("resource focus keeps only flows that declare it", () => {
    const sliced = sliceManifestForFocus(FLOWS_TEST_MANIFEST, {
      kind: "resource",
      nodeId: "sql:shipments",
    });
    expect(Object.keys(sliced.flows ?? {})).toEqual(["fulfillment.onOrder"]);
  });

  test("mcp: callees are not treated as flow ids", () => {
    const manifest = {
      ...FLOWS_TEST_MANIFEST,
      flows: {
        ...FLOWS_TEST_MANIFEST.flows,
        "support.triage": {
          effects: { calls: ["mcp:github/create_issue"] },
        },
      },
    };
    const sliced = sliceManifestForFocus(manifest, { kind: "unit", unit: "support" });
    expect(Object.keys(sliced.flows ?? {})).toEqual(["support.triage"]);
    expect(flowTouchesNode(manifest.flows!["support.triage"]!, "support.triage", "mcp:github")).toBe(
      true,
    );
  });

  test("sliced Manifest lays out a small graph", () => {
    const sliced = sliceManifestForFocus(FLOWS_TEST_MANIFEST, {
      kind: "unit",
      unit: "bookings",
    });
    const { nodes } = buildFlowGraph(sliced);
    expect(nodes.filter((n) => n.data.kind === "unit").map((n) => n.id)).toEqual(["unit:bookings"]);
    expect(nodes.some((n) => n.id === "flow:fulfillment.onOrder")).toBe(false);
  });
});
