/**
 * Manifest → Flow graph — declared structure only (not runtime traffic).
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { FLOWS_TEST_MANIFEST } from "../../../../../ui/flows/fixture.ts";
import {
  applyChainHighlight,
  applyEdgeHighlight,
  buildFlowGraph,
  callersOfFlow,
  unitOfFlowId,
  actionOfFlowId,
} from "./build-flow-graph.ts";
import { EDGE_STROKE } from "./flow-graph-theme.ts";

/** Fixture with an AI ask so the graph covers every effect edge kind. */
const baseFlows = FLOWS_TEST_MANIFEST.flows!;
const GRAPH_MANIFEST: Manifest = {
  ...FLOWS_TEST_MANIFEST,
  flows: {
    ...baseFlows,
    "payments.chargeBooking": {
      ...baseFlows["payments.chargeBooking"]!,
      effects: {
        ...baseFlows["payments.chargeBooking"]!.effects,
        asks: ["ticket-triage"],
      },
    },
  },
};

describe("unitOfFlowId / actionOfFlowId", () => {
  test("splits dotted flow ids", () => {
    expect(unitOfFlowId("bookings.create")).toBe("bookings");
    expect(actionOfFlowId("bookings.create")).toBe("create");
  });

  test("falls back when there is no dot", () => {
    expect(unitOfFlowId("ping")).toBe("ping");
    expect(actionOfFlowId("ping")).toBe("ping");
  });
});

describe("buildFlowGraph", () => {
  const { nodes, edges, flowIds } = buildFlowGraph(GRAPH_MANIFEST);

  test("indexes every Manifest flow id", () => {
    expect([...flowIds].sort()).toEqual([
      "bookings.create",
      "bookings.mine",
      "fulfillment.onOrder",
      "payments.chargeBooking",
    ]);
  });

  test("builds unit group + flow nodes from Manifest structure", () => {
    const unitIds = nodes.filter((n) => n.data.kind === "unit").map((n) => n.id);
    expect(unitIds).toEqual(["unit:bookings", "unit:fulfillment", "unit:payments"]);

    const flowNode = nodes.find((n) => n.id === "flow:bookings.create");
    expect(flowNode?.type).toBe("flow");
    expect(flowNode?.parentId).toBe("unit:bookings");
    expect(flowNode?.data).toMatchObject({
      kind: "flow",
      label: "create",
      refId: "bookings.create",
      unit: "bookings",
      plane: "user",
    });
  });

  test("creates store / signal / AI target nodes from declared effects", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("sql:bookings")?.data).toMatchObject({
      kind: "store",
      label: "bookings",
      facet: "sql",
    });
    expect(byId.get("sql:shipments")?.data.kind).toBe("store");
    expect(byId.get("signal:order-placed")?.data).toMatchObject({
      kind: "signal",
      label: "order-placed",
    });
    expect(byId.get("ai:ticket-triage")?.data).toMatchObject({
      kind: "ai",
      label: "ticket-triage",
    });
  });

  test("edges are declared Manifest effects — not runtime traffic", () => {
    const edgeIds = new Set(edges.map((e) => e.id));

    // reads / writes are distinct edges (color-coded by kind), even to the same store
    expect(edgeIds.has("e:flow:bookings.create-reads->sql:bookings")).toBe(true);
    expect(edgeIds.has("e:flow:bookings.create-writes->sql:bookings")).toBe(true);
    // emits → signal
    expect(edgeIds.has("e:flow:bookings.create->signal:order-placed")).toBe(true);
    // trigger.signal → inbound to flow
    expect(edgeIds.has("e:signal:order-placed->flow:fulfillment.onOrder")).toBe(true);
    // calls → flow→flow (animated)
    const call = edges.find((e) => e.id === "e:flow:payments.chargeBooking->flow:bookings.create");
    expect(call?.animated).toBe(true);
    expect(call?.data?.kind).toBe("calls");
    // asks → AI
    expect(edgeIds.has("e:flow:payments.chargeBooking->ai:ticket-triage")).toBe(true);

    // No phantom runtime-only edges (e.g. from a live run that never appears in Manifest).
    expect(edges.every((e) => !e.id.includes("runtime"))).toBe(true);
  });

  test("edge strokes encode effect kind as real color (not style-only)", () => {
    const byKind = new Map(edges.map((e) => [e.data?.kind, e.style?.stroke]));
    expect(byKind.get("reads")).toBe("#2DD4BF");
    expect(byKind.get("writes")).toBe("#FB923C");
    expect(byKind.get("emits")).toBe("#FBBF24");
    expect(byKind.get("calls")).toBe("#60A5FA");
    expect(byKind.get("asks")).toBe("#FB7185");
    expect(byKind.get("trigger")).toBe("#FBBF24");
    // Every edge is an explicit smoothstep ribbon (never straight/step).
    expect(edges.every((e) => e.type === "smoothstep")).toBe(true);
  });

  test("callersOfFlow reuses effects.calls reverse-index (same as call edges)", () => {
    // Call edges in the graph are the forward walk; callersOfFlow is the reverse.
    const callEdges = edges.filter((e) => e.data?.kind === "calls");
    expect(callEdges.length).toBeGreaterThan(0);
    for (const e of callEdges) {
      const caller = e.source.replace(/^flow:/, "");
      const callee = e.target.replace(/^flow:/, "");
      expect(callersOfFlow(GRAPH_MANIFEST, callee)).toContain(caller);
    }
    expect(callersOfFlow(GRAPH_MANIFEST, "bookings.create")).toEqual(["payments.chargeBooking"]);
    expect(callersOfFlow(GRAPH_MANIFEST, "payments.chargeBooking")).toEqual([]);
  });

  test("unit groups hug content bounds instead of a fixed dead-space box", () => {
    const unit = nodes.find((n) => n.id === "unit:fulfillment");
    const flow = nodes.find((n) => n.id === "flow:fulfillment.onOrder");
    expect(unit?.style?.width).toBeLessThan(280);
    expect(unit?.style?.height).toBeLessThan(120);
    expect(flow?.parentId).toBe("unit:fulfillment");
    // Child sits inside the header/pad chrome, not at a naive ROW_H stack offset.
    expect(flow?.position.y).toBeGreaterThan(20);
    expect(flow?.position.y).toBeLessThan(40);
  });

  test("empty / null Manifest yields an empty graph", () => {
    expect(buildFlowGraph(null).nodes).toEqual([]);
    expect(buildFlowGraph(undefined).edges).toEqual([]);
    expect(buildFlowGraph({ oke: "1.0", app: "x" }).flowIds.size).toBe(0);
  });
});

describe("applyChainHighlight", () => {
  const { nodes } = buildFlowGraph(GRAPH_MANIFEST);

  test("marks chain flows highlighted and dims the rest when a chain is active", () => {
    const next = applyChainHighlight(
      nodes,
      new Set(["bookings.create", "fulfillment.onOrder"]),
      new Set(["signal:order-placed"]),
    );
    const create = next.find((n) => n.id === "flow:bookings.create");
    const mine = next.find((n) => n.id === "flow:bookings.mine");
    const signal = next.find((n) => n.id === "signal:order-placed");
    const unit = next.find((n) => n.id === "unit:bookings");

    expect(create?.data.highlighted).toBe(true);
    expect(create?.data.dimmed).toBe(false);
    expect(mine?.data.highlighted).toBe(false);
    expect(mine?.data.dimmed).toBe(true);
    expect(signal?.data.highlighted).toBe(true);
    expect(unit?.data.highlighted).toBeUndefined();
  });

  test("leaves nodes undimmed when nothing is selected", () => {
    const next = applyChainHighlight(nodes, new Set(), new Set());
    expect(next.every((n) => n.data.kind === "unit" || n.data.dimmed !== true)).toBe(true);
  });
});

describe("applyEdgeHighlight", () => {
  const { nodes, edges } = buildFlowGraph(GRAPH_MANIFEST);

  test("mutes off-chain edges when a chain is active", () => {
    const highlighted = applyChainHighlight(
      nodes,
      new Set(["bookings.create", "fulfillment.onOrder"]),
      new Set(["signal:order-placed"]),
    );
    const next = applyEdgeHighlight(edges, highlighted);
    const emit = next.find((e) => e.id === "e:flow:bookings.create->signal:order-placed");
    const trigger = next.find((e) => e.id === "e:signal:order-placed->flow:fulfillment.onOrder");
    const call = next.find((e) => e.id === "e:flow:payments.chargeBooking->flow:bookings.create");

    expect(emit?.style?.opacity).toBe(1);
    expect(trigger?.style?.opacity).toBe(1);
    expect(call?.style?.opacity).toBe(0.32);
    expect(emit?.style?.stroke).toBe(EDGE_STROKE.emits);
  });
});
