/**
 * Architecture view projection (console §9.13).
 *
 * Default: clustered by unit with aggregated edges.
 * Focus: neighbourhood at depth 1–2.
 * Layers: typed toggles over declared edges.
 * Traffic: thickness + dashed from Runs.
 */

import type { CausalityGraph } from "../flows/graph.ts";
import type { RunRecord } from "../runs/types.ts";
import { boundaryCrossingCount, boundaryCrossingRefs } from "./boundary.ts";
import {
  declaredEdgesOf,
  type DeclaredEdge,
  unitOfFlowId,
} from "./declared.ts";
import { isBoundaryExternal, labelOfRef } from "./layers.ts";
import { computePathologies } from "./pathologies.ts";
import {
  observeTraffic,
  thicknessOf,
  traversalsOf,
} from "./traffic.ts";
import type {
  ArchitectureEdge,
  ArchitectureNode,
  ArchitectureView,
  ElementLayer,
  FocusDepth,
  LayerFlags,
} from "./types.ts";
import { DEFAULT_LAYERS } from "./types.ts";

/** Options for {@link buildArchitectureView}. */
export interface ArchitectureViewOptions {
  /** Focus node id (`unit:…`, `flow:…`, effect ref), or null for cluster overview. */
  readonly focus?: string | null;
  /** Neighbourhood depth when focused (default 1). */
  readonly depth?: FocusDepth;
  /** Layer toggles (default all on). */
  readonly layers?: LayerFlags;
  /** Runs population for traffic (default empty → all declared edges dashed). */
  readonly runs?: readonly RunRecord[];
}

/**
 * Project the Flows causality graph into an architecture view.
 *
 * @param graph - Causality graph from {@link buildCausalityGraph}
 * @param options - Focus, depth, layers, runs
 */
export function buildArchitectureView(
  graph: CausalityGraph,
  options: ArchitectureViewOptions = {},
): ArchitectureView {
  const focus = options.focus ?? null;
  const depth: FocusDepth = options.depth === 2 ? 2 : 1;
  const layers = options.layers ?? DEFAULT_LAYERS;
  const traffic = observeTraffic(options.runs ?? []);
  const declared = declaredEdgesOf(graph);
  const findings = computePathologies(graph);
  const crossings = boundaryCrossingCount(graph);

  if (focus) {
    return buildFocusedView({
      graph,
      declared,
      traffic,
      focus,
      depth,
      layers,
      findings,
      crossings,
    });
  }

  return buildClusteredView({
    graph,
    declared,
    traffic,
    layers,
    findings,
    crossings,
  });
}

function buildClusteredView(input: {
  readonly graph: CausalityGraph;
  readonly declared: readonly DeclaredEdge[];
  readonly traffic: ReadonlyMap<string, number>;
  readonly layers: LayerFlags;
  readonly findings: ArchitectureView["findings"];
  readonly crossings: number;
}): ArchitectureView {
  const { graph, declared, traffic, layers, findings, crossings } = input;

  const units = [...new Set(graph.flows.map((f) => f.unit))].sort();
  const nodes: ArchitectureNode[] = units.map((unit) => ({
    id: `unit:${unit}`,
    kind: "unit" as const,
    label: unit,
    unit,
    insideBoundary: true,
    flowCount: graph.flows.filter((f) => f.unit === unit).length,
  }));

  // External resources sit outside the drawn boundary
  for (const ref of boundaryCrossingRefs(graph)) {
    nodes.push({
      id: ref,
      kind: "external",
      label: labelOfRef(ref),
      layer: "external",
      insideBoundary: false,
    });
  }

  const agg = new Map<
    string,
    {
      from: string;
      to: string;
      layer: ElementLayer | "call";
      traversals: number;
      declared: boolean;
    }
  >();

  for (const edge of declared) {
    if (!layerVisible(edge.layer, layers)) continue;

    const fromId = `unit:${edge.fromUnit}`;
    let toId: string | null = null;

    // Boundary crossings: unit → external resource (outside the drawn boundary)
    if (edge.toUnit === "external" || isBoundaryExternal(edge.to)) {
      toId = edge.ref ?? edge.to;
    } else if (edge.fromUnit !== edge.toUnit) {
      // Inter-unit coupling (call / messaging fan-out / cross-unit data)
      toId = `unit:${edge.toUnit}`;
    } else {
      // Intra-unit edges stay collapsed in the default cluster overview
      continue;
    }

    if (fromId === toId) continue;

    const key = `${fromId}\0${toId}\0${edge.layer}`;
    const trav = edge.ref
      ? traversalsOf(traffic, edge.flowId, edge.ref)
      : 0;
    const existing = agg.get(key);
    if (existing) {
      existing.traversals += trav;
    } else {
      agg.set(key, {
        from: fromId,
        to: toId,
        layer: edge.layer,
        traversals: trav,
        declared: true,
      });
    }
  }

  const edges = materializeEdges(agg, true);
  return {
    nodes: dedupeNodes(nodes),
    edges,
    boundaryCrossingCount: crossings,
    findings,
    focus: null,
    depth: 1,
    layers,
  };
}

function buildFocusedView(input: {
  readonly graph: CausalityGraph;
  readonly declared: readonly DeclaredEdge[];
  readonly traffic: ReadonlyMap<string, number>;
  readonly focus: string;
  readonly depth: FocusDepth;
  readonly layers: LayerFlags;
  readonly findings: ArchitectureView["findings"];
  readonly crossings: number;
}): ArchitectureView {
  const { graph, declared, traffic, focus, depth, layers, findings, crossings } =
    input;

  const neighbourhood = neighbourhoodIds(graph, declared, focus, depth);
  const nodes: ArchitectureNode[] = [];

  for (const id of neighbourhood) {
    const hop = distanceFromFocus(graph, declared, focus, id, depth);
    if (id.startsWith("unit:")) {
      const unit = id.slice("unit:".length);
      nodes.push({
        id,
        kind: "unit",
        label: unit,
        unit,
        insideBoundary: true,
        flowCount: graph.flows.filter((f) => f.unit === unit).length,
        focused: id === focus,
        depth: hop,
      });
      continue;
    }
    if (id.startsWith("flow:")) {
      const flowId = id.slice("flow:".length);
      const flow = graph.flowById.get(flowId);
      nodes.push({
        id,
        kind: "flow",
        label: flowId,
        unit: flow?.unit ?? unitOfFlowId(flowId),
        insideBoundary: true,
        focused: id === focus,
        depth: hop,
      });
      continue;
    }
    if (id.startsWith("cause:")) {
      const causeId = id.slice("cause:".length);
      const cause = graph.causeById.get(causeId);
      const layer =
        cause?.kind === "cron" || cause?.kind === "every"
          ? ("time" as const)
          : cause?.kind === "signal"
            ? ("messaging" as const)
            : undefined;
      if (!layer || !layers[layer]) continue;
      nodes.push({
        id,
        kind: "resource",
        label: cause?.label ?? causeId,
        layer,
        insideBoundary: true,
        focused: id === focus,
        depth: hop,
      });
      continue;
    }
    nodes.push({
      id,
      kind: isBoundaryExternal(id) ? "external" : "resource",
      label: labelOfRef(id),
      layer: isBoundaryExternal(id)
        ? "external"
        : id.startsWith("signal:")
          ? "messaging"
          : "data",
      insideBoundary: !isBoundaryExternal(id),
      focused: id === focus,
      depth: hop,
    });
  }

  // Ensure focus itself is present
  if (!nodes.some((n) => n.id === focus)) {
    nodes.push(...materializeFocusNode(graph, focus));
  }

  const edgeAgg = new Map<
    string,
    {
      from: string;
      to: string;
      layer: ElementLayer | "call";
      traversals: number;
      declared: boolean;
    }
  >();

  const visible = new Set(nodes.map((n) => n.id));

  for (const edge of declared) {
    if (!layerVisible(edge.layer, layers)) continue;
    const from = edge.from;
    const to = edge.to;
    if (!visible.has(from) || !visible.has(to)) continue;

    const key = `${from}\0${to}\0${edge.layer}`;
    const trav = edge.ref
      ? traversalsOf(traffic, edge.flowId, edge.ref)
      : 0;
    const existing = edgeAgg.get(key);
    if (existing) {
      existing.traversals += trav;
    } else {
      edgeAgg.set(key, {
        from,
        to,
        layer: edge.layer,
        traversals: trav,
        declared: true,
      });
    }
  }

  return {
    nodes: dedupeNodes(nodes),
    edges: materializeEdges(edgeAgg, false),
    boundaryCrossingCount: crossings,
    findings,
    focus,
    depth,
    layers,
  };
}

function materializeFocusNode(
  graph: CausalityGraph,
  focus: string,
): ArchitectureNode[] {
  if (focus.startsWith("unit:")) {
    const unit = focus.slice("unit:".length);
    return [
      {
        id: focus,
        kind: "unit",
        label: unit,
        unit,
        insideBoundary: true,
        flowCount: graph.flows.filter((f) => f.unit === unit).length,
        focused: true,
        depth: 0,
      },
    ];
  }
  if (focus.startsWith("flow:")) {
    const flowId = focus.slice("flow:".length);
    return [
      {
        id: focus,
        kind: "flow",
        label: flowId,
        unit: graph.flowById.get(flowId)?.unit ?? unitOfFlowId(flowId),
        insideBoundary: true,
        focused: true,
        depth: 0,
      },
    ];
  }
  return [
    {
      id: focus,
      kind: isBoundaryExternal(focus) ? "external" : "resource",
      label: labelOfRef(focus),
      layer: isBoundaryExternal(focus)
        ? "external"
        : focus.startsWith("signal:")
          ? "messaging"
          : "data",
      insideBoundary: !isBoundaryExternal(focus),
      focused: true,
      depth: 0,
    },
  ];
}

function neighbourhoodIds(
  graph: CausalityGraph,
  declared: readonly DeclaredEdge[],
  focus: string,
  depth: FocusDepth,
): Set<string> {
  const ids = new Set<string>([focus]);

  // Expand unit focus into its flows
  if (focus.startsWith("unit:")) {
    const unit = focus.slice("unit:".length);
    for (const flow of graph.flows) {
      if (flow.unit === unit) ids.add(`flow:${flow.id}`);
    }
  }

  let frontier = new Set(ids);
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const edge of declared) {
      const from = edge.from;
      const to = edge.to;
      if (frontier.has(from)) next.add(to);
      if (frontier.has(to)) next.add(from);
      // Unit ↔ flow membership
      for (const end of [from, to]) {
        if (!end.startsWith("flow:")) continue;
        const unitId = `unit:${unitOfFlowId(end.slice("flow:".length))}`;
        if (frontier.has(end)) next.add(unitId);
        if (frontier.has(unitId)) next.add(end);
      }
    }
    for (const id of next) ids.add(id);
    frontier = next;
  }

  return ids;
}

function distanceFromFocus(
  graph: CausalityGraph,
  declared: readonly DeclaredEdge[],
  focus: string,
  target: string,
  maxDepth: FocusDepth,
): number {
  if (focus === target) return 0;
  const seen = new Set<string>([focus]);
  let frontier = new Set<string>([focus]);
  for (let hop = 1; hop <= maxDepth; hop++) {
    const next = new Set<string>();
    for (const edge of declared) {
      const from = edge.from;
      const to = edge.to;
      for (const [a, b] of [
        [from, to],
        [to, from],
      ] as const) {
        if (!frontier.has(a)) continue;
        if (b === target) return hop;
        if (!seen.has(b)) {
          seen.add(b);
          next.add(b);
        }
      }
    }
    // unit membership hops
    for (const id of frontier) {
      if (id.startsWith("flow:")) {
        const unitId = `unit:${unitOfFlowId(id.slice("flow:".length))}`;
        if (unitId === target) return hop;
        if (!seen.has(unitId)) {
          seen.add(unitId);
          next.add(unitId);
        }
      }
      if (id.startsWith("unit:")) {
        const unit = id.slice("unit:".length);
        for (const flow of graph.flows) {
          if (flow.unit !== unit) continue;
          const fid = `flow:${flow.id}`;
          if (fid === target) return hop;
          if (!seen.has(fid)) {
            seen.add(fid);
            next.add(fid);
          }
        }
      }
    }
    frontier = next;
  }
  return maxDepth;
}

function layerVisible(
  layer: ElementLayer | "call",
  layers: LayerFlags,
): boolean {
  if (layer === "call") return true;
  return layers[layer];
}

function materializeEdges(
  agg: ReadonlyMap<
    string,
    {
      from: string;
      to: string;
      layer: ElementLayer | "call";
      traversals: number;
      declared: boolean;
    }
  >,
  aggregated: boolean,
): ArchitectureEdge[] {
  const maxTrav = Math.max(0, ...[...agg.values()].map((e) => e.traversals));
  return [...agg.values()]
    .map((e) => ({
      id: `${e.from}->${e.to}:${e.layer}`,
      from: e.from,
      to: e.to,
      layer: e.layer,
      declared: e.declared,
      traversals: e.traversals,
      dashed: e.declared && e.traversals === 0,
      thickness: thicknessOf(e.traversals, maxTrav),
      aggregated,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function dedupeNodes(nodes: readonly ArchitectureNode[]): ArchitectureNode[] {
  const map = new Map<string, ArchitectureNode>();
  for (const n of nodes) {
    if (!map.has(n.id)) map.set(n.id, n);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Toggle one element layer in the flags map.
 *
 * @param layers - Current flags
 * @param layer - Layer to flip
 * @param on - Desired state
 */
export function setLayer(
  layers: LayerFlags,
  layer: ElementLayer,
  on: boolean,
): LayerFlags {
  return { ...layers, [layer]: on };
}
