/**
 * Causality graph — bidirectional traversal (console §9.1).
 */

import { describe, expect, test } from "bun:test";
import { FLOWS_TEST_MANIFEST } from "./fixture.ts";
import {
  buildCausalityGraph,
  causeIdsFor,
  centreFlows,
  leftCauses,
  rightEffects,
} from "./graph.ts";
import { parseFlowsSearch, selectEffect, serializeFlowsSearch } from "./search.ts";

describe("causality graph", () => {
  const graph = buildCausalityGraph(FLOWS_TEST_MANIFEST);

  test("indexes flows, causes, and effects", () => {
    expect(graph.flows.map((f) => f.id)).toContain("bookings.create");
    expect(graph.causeById.has("http:POST:/bookings")).toBe(true);
    expect(graph.effectByRef.has("sql:bookings")).toBe(true);
  });

  test("selecting a table shows every flow touching it and their triggers", () => {
    const centre = centreFlows(graph, {
      sel: "effect",
      effect: "sql:bookings",
    });
    const related = centre.filter((f) => f.related);
    expect(related.map((f) => f.id).sort()).toEqual([
      "bookings.create",
      "bookings.mine",
    ]);

    const causes = leftCauses(graph, {
      sel: "effect",
      effect: "sql:bookings",
    }).filter((c) => c.related);
    expect(causes.map((c) => c.id).sort()).toEqual([
      "http:GET:/bookings",
      "http:POST:/bookings",
    ]);
  });

  test("internal flows show callers as causes", () => {
    const nodes = causeIdsFor(undefined, "payments.chargeBooking", [
      "ops.runCharge",
    ]);
    expect(nodes.map((n) => n.id)).toEqual(["caller:ops.runCharge"]);
    expect(nodes[0]?.kind).toBe("caller");
  });

  test("external effects are flagged on the centre row", () => {
    const fulfillment = graph.flowById.get("fulfillment.onOrder");
    expect(fulfillment?.external).toBe(true);
    expect(fulfillment?.peakTier).toBe("external");
  });

  test("dim never hide — non-matches stay with match=false", () => {
    const centre = centreFlows(graph, {
      sel: "effect",
      effect: "sql:bookings",
      q: "create",
    });
    expect(centre.length).toBe(graph.flows.length);
    const create = centre.find((f) => f.id === "bookings.create");
    const mine = centre.find((f) => f.id === "bookings.mine");
    expect(create?.match).toBe(true);
    expect(mine?.match).toBe(false);
    expect(mine?.related).toBe(true);
  });

  test("idle inventory ranks by touch count", () => {
    const idle = rightEffects(graph, { sel: "none" });
    const bookings = idle.find((e) => e.ref === "sql:bookings");
    expect(bookings?.touchCount).toBe(2);
  });
});

describe("URL traversal state", () => {
  test("pasted URL reproduces the exact traversal state", () => {
    let search = parseFlowsSearch({});
    search = selectEffect(search, "sql:bookings");
    search = { ...search, q: "book", density: "compact", transitive: true };
    const serialized = serializeFlowsSearch(search);
    const restored = parseFlowsSearch(serialized);
    expect(restored.sel).toBe("effect");
    expect(restored.effect).toBe("sql:bookings");
    expect(restored.q).toBe("book");
    expect(restored.density).toBe("compact");
    expect(restored.transitive).toBe(true);
    expect(restored.path).toBe("sql:bookings");
  });

  test("invalid search falls back to defaults", () => {
    const parsed = parseFlowsSearch({ sel: "nope", density: 1 });
    expect(parsed.sel).toBe("none");
    expect(parsed.density).toBe("comfortable");
  });
});
