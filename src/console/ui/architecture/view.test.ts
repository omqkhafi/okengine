/**
 * Architecture view — cluster default, focus depth, layers, traffic (§9.13).
 */

import { describe, expect, test } from "bun:test";
import { buildCausalityGraph } from "../flows/graph.ts";
import { boundaryCrossingCount } from "./boundary.ts";
import { ARCHITECTURE_RUNS_FIXTURE, ARCHITECTURE_TEST_MANIFEST } from "./fixture.ts";
import { computePathologies } from "./pathologies.ts";
import { layersOf, parseArchitectureSearch, serializeArchitectureSearch } from "./search.ts";
import { observeTraffic, thicknessOf } from "./traffic.ts";
import { buildArchitectureView } from "./view.ts";

describe("architecture view", () => {
  const graph = buildCausalityGraph(ARCHITECTURE_TEST_MANIFEST);

  test("reuses Flows causality graph — same flow ids", () => {
    expect(graph.flowById.has("bookings.create")).toBe(true);
    expect(graph.effectByRef.has("sql:bookings")).toBe(true);
  });

  test("default is clustered by unit — never every flow", () => {
    const view = buildArchitectureView(graph, {
      runs: ARCHITECTURE_RUNS_FIXTURE,
    });
    const kinds = new Set(view.nodes.map((n) => n.kind));
    expect(kinds.has("unit")).toBe(true);
    expect(view.nodes.some((n) => n.kind === "flow")).toBe(false);
    expect(view.nodes.some((n) => n.id === "unit:bookings")).toBe(true);
    expect(view.edges.every((e) => e.aggregated)).toBe(true);
  });

  test("focus expands neighbourhood at depth 1–2", () => {
    const d1 = buildArchitectureView(graph, {
      focus: "unit:bookings",
      depth: 1,
      runs: ARCHITECTURE_RUNS_FIXTURE,
    });
    expect(d1.focus).toBe("unit:bookings");
    expect(d1.nodes.some((n) => n.id === "flow:bookings.create")).toBe(true);

    const d2 = buildArchitectureView(graph, {
      focus: "unit:bookings",
      depth: 2,
      runs: ARCHITECTURE_RUNS_FIXTURE,
    });
    expect(d2.nodes.length).toBeGreaterThanOrEqual(d1.nodes.length);
  });

  test("element layers toggle typed edges", () => {
    const all = buildArchitectureView(graph, {
      layers: {
        data: true,
        messaging: true,
        time: true,
        external: true,
      },
    });
    const noExternal = buildArchitectureView(graph, {
      layers: {
        data: true,
        messaging: true,
        time: true,
        external: false,
      },
    });
    expect(all.edges.some((e) => e.layer === "external")).toBe(true);
    expect(noExternal.edges.some((e) => e.layer === "external")).toBe(false);

    const withTime = buildArchitectureView(graph, {
      focus: "flow:ops.nightlyReconcile",
      depth: 1,
      layers: {
        data: false,
        messaging: false,
        time: true,
        external: false,
      },
    });
    expect(withTime.edges.some((e) => e.layer === "time")).toBe(true);
  });

  test("boundary crossing count comes from Manifest external effects", () => {
    const count = boundaryCrossingCount(graph);
    expect(count).toBe(1); // channel:booking-confirmed
    const view = buildArchitectureView(graph);
    expect(view.boundaryCrossingCount).toBe(count);
    expect(view.nodes.some((n) => n.id === "channel:booking-confirmed")).toBe(true);
    expect(view.nodes.find((n) => n.id === "channel:booking-confirmed")?.insideBoundary).toBe(
      false,
    );
  });

  test("edge thickness follows Runs traffic; zero traversals are dashed", () => {
    const view = buildArchitectureView(graph, {
      runs: ARCHITECTURE_RUNS_FIXTURE,
    });
    const withTraffic = view.edges.filter((e) => e.traversals > 0);
    const dashed = view.edges.filter((e) => e.dashed);
    expect(dashed.length).toBeGreaterThan(0);
    expect(dashed.every((e) => e.traversals === 0)).toBe(true);
    if (withTraffic.length > 0) {
      expect(withTraffic.every((e) => !e.dashed)).toBe(true);
      expect(withTraffic.every((e) => e.thickness >= 1)).toBe(true);
    }
  });

  test("pathologies surface as findings", () => {
    const findings = computePathologies(graph);
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has("cycle")).toBe(true);
    expect(kinds.has("god-node")).toBe(true);
    expect(kinds.has("orphan-signal")).toBe(true);
    expect(kinds.has("spof")).toBe(true);
    expect(findings.some((f) => f.detail.includes("legacy-unused"))).toBe(true);
  });
});

describe("architecture traffic helpers", () => {
  test("observeTraffic counts flow→resource traversals", () => {
    const traffic = observeTraffic(ARCHITECTURE_RUNS_FIXTURE);
    expect(traffic.size).toBeGreaterThan(0);
  });

  test("thickness scales 1–8", () => {
    expect(thicknessOf(0, 100)).toBe(1);
    expect(thicknessOf(100, 100)).toBe(8);
    expect(thicknessOf(50, 100)).toBe(4);
  });
});

describe("architecture URL search", () => {
  test("round-trips focus, depth, and layer offs", () => {
    const parsed = parseArchitectureSearch({
      focus: "unit:bookings",
      depth: "2",
      external: "false",
    });
    expect(parsed.focus).toBe("unit:bookings");
    expect(parsed.depth).toBe(2);
    expect(layersOf(parsed).external).toBe(false);
    expect(layersOf(parsed).data).toBe(true);
    const serialized = serializeArchitectureSearch(parsed);
    expect(serialized.focus).toBe("unit:bookings");
    expect(serialized.depth).toBe("2");
    expect(serialized.external).toBe("false");
  });

  test("invalid search falls back", () => {
    const parsed = parseArchitectureSearch({ depth: "9", focus: 1 });
    expect(parsed.depth).toBe(1);
  });
});
