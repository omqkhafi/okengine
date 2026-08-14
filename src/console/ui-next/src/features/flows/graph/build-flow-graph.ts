/**
 * Manifest → React Flow graph (pure).
 *
 * Nodes: flows grouped by unit, plus the store / signal / AI / clock / gate /
 * vault / channel targets each flow declares. Edges are declared (from the
 * Manifest), not runtime traffic. Used for the 1-hop neighborhood; the
 * default canvas is the eight-element map in `element-map.ts`.
 */

import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Flow, Manifest } from "../../../../../../manifest/types.ts";
import type { OkeElement } from "@/lib/element-icons.ts";
import {
  EDGE_STROKE,
  GRAPH_Z,
  NODE_BOX,
  UNIT_CHROME,
  type FlowGraphEdgeKind,
} from "./flow-graph-theme.ts";

/** Node kinds rendered by the Flow graph. */
export type FlowGraphNodeKind = "unit" | "element" | "law" | OkeElement;

/** Custom data carried on every graph node. */
export type FlowGraphNodeData = {
  readonly kind: FlowGraphNodeKind;
  readonly label: string;
  /** Flow id for flow nodes; resource ref for targets. */
  readonly refId: string;
  /** Unit segment (flow nodes). */
  readonly unit?: string;
  /** Plane badge (flow nodes). */
  readonly plane?: string;
  /** Store facet (store nodes). */
  readonly facet?: string;
  /** Compact metadata badge (count / type). */
  readonly badge?: string;
  /** Elements this unit chip couples to (overview map). */
  readonly elements?: readonly OkeElement[];
  /** Recent-run count painted on map chips / hubs. */
  readonly live?: number;
  /** Error-run count painted on map chips / hubs. */
  readonly errors?: number;
  /** Dimmed when a trace chain is highlighted and this node is not in it. */
  readonly dimmed?: boolean;
  /** Emphasis ring when part of the highlighted chain. */
  readonly highlighted?: boolean;
  /** Pulsing during Replay playback (active chain step). */
  readonly active?: boolean;
  /** Emphasized by sticky sheet focus (store / signal / ai resource). */
  readonly focused?: boolean;
};

export type FlowGraphNode = Node<FlowGraphNodeData>;

/** Custom data on declared effect edges. */
export type FlowGraphEdgeData = {
  readonly kind: FlowGraphEdgeKind;
};

export type FlowGraphEdge = Edge<FlowGraphEdgeData> & {
  /** SmoothStep ribbon radius (xyflow path option). */
  readonly pathOptions?: { readonly borderRadius?: number; readonly offset?: number };
};

/** Unit segment of a flow id (`bookings.create` → `bookings`). */
export function unitOfFlowId(flowId: string): string {
  const i = flowId.indexOf(".");
  return i === -1 ? flowId : flowId.slice(0, i);
}

/** Action segment of a flow id (`bookings.create` → `create`). */
export function actionOfFlowId(flowId: string): string {
  const i = flowId.indexOf(".");
  return i === -1 ? flowId : flowId.slice(i + 1);
}

/**
 * Reverse index: callee → callers, from Manifest `effects.calls`.
 *
 * Same walk as the call edges in {@link buildFlowGraph} — one source of truth
 * for Units call-only framing and the Flows graph.
 *
 * @param manifest - Live Manifest (null → empty)
 */
export function callersIndex(
  manifest: Manifest | null | undefined,
): ReadonlyMap<string, readonly string[]> {
  const flowsMap = manifest?.flows ?? {};
  const callersOf = new Map<string, string[]>();
  for (const id of Object.keys(flowsMap)) {
    const calls = flowsMap[id]?.effects?.calls ?? [];
    for (const callee of calls) {
      const list = callersOf.get(callee) ?? [];
      list.push(id);
      callersOf.set(callee, list);
    }
  }
  for (const [callee, list] of callersOf) {
    list.sort((a, b) => a.localeCompare(b));
    callersOf.set(callee, list);
  }
  return callersOf;
}

/**
 * Flows that declare `effects.calls` including `flowId`.
 *
 * @param manifest - Live Manifest
 * @param flowId - Callee flow id
 */
export function callersOfFlow(
  manifest: Manifest | null | undefined,
  flowId: string,
): readonly string[] {
  return callersIndex(manifest).get(flowId) ?? [];
}

interface TargetSpec {
  readonly id: string;
  readonly kind: "store" | "signal" | "ai" | "clock" | "gate" | "vault" | "channel";
  readonly label: string;
  readonly facet?: string;
}

function targetFromRef(ref: string): TargetSpec | null {
  if (ref.startsWith("sql:")) return { id: ref, kind: "store", label: ref.slice(4), facet: "sql" };
  if (ref.startsWith("kv:")) return { id: ref, kind: "store", label: ref.slice(3), facet: "kv" };
  if (ref.startsWith("files:"))
    return { id: ref, kind: "store", label: ref.slice(6), facet: "files" };
  if (ref.startsWith("index:"))
    return { id: ref, kind: "store", label: ref.slice(6), facet: "index" };
  if (ref.startsWith("signal:")) return { id: ref, kind: "signal", label: ref.slice(7) };
  if (ref.startsWith("ai:")) return { id: ref, kind: "ai", label: ref.slice(3) };
  if (ref.startsWith("vault:")) return { id: ref, kind: "vault", label: ref.slice(6) };
  if (ref.startsWith("channel:")) return { id: ref, kind: "channel", label: ref.slice(8) };
  if (ref.startsWith("gate:")) return { id: ref, kind: "gate", label: ref.slice(5) };
  if (ref.startsWith("clock:")) return { id: ref, kind: "clock", label: ref.slice(6) };
  return null;
}

function styledEdge(
  id: string,
  source: string,
  target: string,
  kind: FlowGraphEdgeKind,
  animated = false,
): FlowGraphEdge {
  const stroke = EDGE_STROKE[kind];
  return {
    id,
    source,
    target,
    // SmoothStep with large radius → flowing ribbon (never straight/orthogonal step).
    type: "smoothstep",
    animated,
    data: { kind },
    style: {
      stroke,
      strokeWidth: kind === "calls" ? 2.5 : 2.25,
    },
    pathOptions: { borderRadius: 28 },
    zIndex: GRAPH_Z.edge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: stroke,
    },
  };
}

/** Build React Flow nodes + edges from a Manifest snapshot. */
export function buildFlowGraph(manifest: Manifest | null | undefined): {
  readonly nodes: FlowGraphNode[];
  readonly edges: FlowGraphEdge[];
  readonly flowIds: ReadonlySet<string>;
} {
  const flows = manifest?.flows ?? {};
  const flowIds = new Set(Object.keys(flows));
  const edges: FlowGraphEdge[] = [];

  const byUnit = new Map<string, string[]>();
  for (const flowId of [...flowIds].sort()) {
    const unit = unitOfFlowId(flowId);
    const list = byUnit.get(unit) ?? [];
    list.push(flowId);
    byUnit.set(unit, list);
  }

  const targets = new Map<string, TargetSpec>();
  const effectCount = new Map<string, number>();

  for (const flowId of flowIds) {
    const flow = flows[flowId];
    if (!flow) continue;

    if (flow.trigger?.signal) {
      const ref = `signal:${flow.trigger.signal}`;
      const spec = targetFromRef(ref);
      if (spec) targets.set(ref, spec);
      edges.push(styledEdge(`e:${ref}->flow:${flowId}`, ref, `flow:${flowId}`, "trigger"));
    }
    if (flow.trigger?.cron || flow.trigger?.every) {
      const ref = `clock:${flowId}`;
      const label = flow.trigger.cron ?? flow.trigger.every ?? flowId;
      targets.set(ref, {
        id: ref,
        kind: "clock",
        label,
        facet: flow.trigger.cron ? "cron" : "every",
      });
      edges.push(styledEdge(`e:${ref}->flow:${flowId}`, ref, `flow:${flowId}`, "trigger"));
    }

    for (const name of flow.gates ?? []) {
      const ref = `gate:${name}`;
      targets.set(ref, { id: ref, kind: "gate", label: name });
      effectCount.set(ref, (effectCount.get(ref) ?? 0) + 1);
      edges.push(styledEdge(`e:flow:${flowId}-gates->${ref}`, `flow:${flowId}`, ref, "gates"));
    }

    const e = flow.effects;
    if (e) {
      for (const r of e.reads ?? []) {
        const spec = targetFromRef(r);
        if (!spec) continue;
        targets.set(r, spec);
        effectCount.set(r, (effectCount.get(r) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}-reads->${r}`, `flow:${flowId}`, r, "reads"));
      }
      for (const r of e.writes ?? []) {
        const spec = targetFromRef(r);
        if (!spec) continue;
        targets.set(r, spec);
        effectCount.set(r, (effectCount.get(r) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}-writes->${r}`, `flow:${flowId}`, r, "writes"));
      }
      for (const s of e.emits ?? []) {
        const ref = `signal:${s}`;
        const spec = targetFromRef(ref);
        if (!spec) continue;
        targets.set(ref, spec);
        effectCount.set(ref, (effectCount.get(ref) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}->${ref}`, `flow:${flowId}`, ref, "emits"));
      }
      for (const a of e.asks ?? []) {
        const ref = `ai:${a}`;
        const spec = targetFromRef(ref);
        if (!spec) continue;
        targets.set(ref, spec);
        effectCount.set(ref, (effectCount.get(ref) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}->${ref}`, `flow:${flowId}`, ref, "asks"));
      }
      for (const s of e.sends ?? []) {
        const ref = `channel:${s}`;
        const spec = targetFromRef(ref);
        if (!spec) continue;
        targets.set(ref, spec);
        effectCount.set(ref, (effectCount.get(ref) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}->${ref}`, `flow:${flowId}`, ref, "sends"));
      }
      for (const s of e.secrets ?? []) {
        const ref = `vault:${s}`;
        const spec = targetFromRef(ref);
        if (!spec) continue;
        targets.set(ref, spec);
        effectCount.set(ref, (effectCount.get(ref) ?? 0) + 1);
        edges.push(styledEdge(`e:flow:${flowId}->${ref}`, `flow:${flowId}`, ref, "secrets"));
      }
      for (const callee of e.calls ?? []) {
        edges.push(
          styledEdge(
            `e:flow:${flowId}->flow:${callee}`,
            `flow:${flowId}`,
            `flow:${callee}`,
            "calls",
            true,
          ),
        );
      }
    }
  }

  const nodes = layoutWithDagre(byUnit, flows, targets, effectCount);
  return { nodes, edges, flowIds };
}

/**
 * LR compound layout: unit parents wrap their flows; targets sit in a later
 * rank so edges route between columns instead of through unrelated groups.
 */
function layoutWithDagre(
  byUnit: Map<string, string[]>,
  flows: Record<string, Flow>,
  targets: Map<string, TargetSpec>,
  effectCount: Map<string, number>,
): FlowGraphNode[] {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: "LR",
    align: "UL",
    nodesep: 16,
    ranksep: 88,
    edgesep: 12,
    marginx: 8,
    marginy: 8,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const [unit, ids] of [...byUnit.entries()].sort()) {
    g.setNode(`unit:${unit}`, {});
    for (const flowId of ids) {
      g.setNode(`flow:${flowId}`, { ...NODE_BOX.flow });
      g.setParent(`flow:${flowId}`, `unit:${unit}`);
    }
  }

  for (const spec of targets.values()) {
    g.setNode(spec.id, { ...NODE_BOX[spec.kind] });
  }

  // Structural edges only (for ranking / ordering) — one per source→target.
  const seen = new Set<string>();
  for (const ids of byUnit.values()) {
    for (const flowId of ids) {
      const flow = flows[flowId];
      if (!flow) continue;
      const link = (source: string, target: string) => {
        const key = `${source}->${target}`;
        if (seen.has(key)) return;
        if (!g.hasNode(source) || !g.hasNode(target)) return;
        seen.add(key);
        g.setEdge(source, target);
      };
      if (flow.trigger?.signal) {
        link(`signal:${flow.trigger.signal}`, `flow:${flowId}`);
      }
      if (flow.trigger?.cron || flow.trigger?.every) {
        link(`clock:${flowId}`, `flow:${flowId}`);
      }
      for (const name of flow.gates ?? []) link(`flow:${flowId}`, `gate:${name}`);
      const e = flow.effects;
      if (!e) continue;
      for (const r of e.reads ?? []) link(`flow:${flowId}`, r);
      for (const r of e.writes ?? []) link(`flow:${flowId}`, r);
      for (const s of e.emits ?? []) link(`flow:${flowId}`, `signal:${s}`);
      for (const a of e.asks ?? []) link(`flow:${flowId}`, `ai:${a}`);
      for (const s of e.sends ?? []) link(`flow:${flowId}`, `channel:${s}`);
      for (const s of e.secrets ?? []) link(`flow:${flowId}`, `vault:${s}`);
      for (const callee of e.calls ?? []) link(`flow:${flowId}`, `flow:${callee}`);
    }
  }

  dagre.layout(g);

  const nodes: FlowGraphNode[] = [];
  const { headerH, padX, padBottom } = UNIT_CHROME;
  const flowGap = 10;

  for (const [unit, ids] of [...byUnit.entries()].sort()) {
    const unitId = `unit:${unit}`;
    const u = g.node(unitId);
    if (!u) continue;

    // Anchor the unit from dagre's compound center, then re-stack flows tightly
    // so groups hug content (dagre compound often leaves vertical dead space).
    const unitCenterX = u.x ?? 0;
    const unitCenterY = u.y ?? 0;
    const stackH = ids.length * NODE_BOX.flow.height + Math.max(0, ids.length - 1) * flowGap;
    const width = NODE_BOX.flow.width + padX * 2;
    const height = headerH + stackH + padBottom;
    const originX = unitCenterX - width / 2;
    const originY = unitCenterY - height / 2;

    nodes.push({
      id: unitId,
      type: "unit",
      position: { x: originX, y: originY },
      data: {
        kind: "unit",
        label: unit,
        refId: unitId,
        badge: String(ids.length),
      },
      selectable: false,
      draggable: false,
      zIndex: GRAPH_Z.unit,
      // Top-level width/height — MiniMap reads these on the user node
      // (`style.width` alone is treated as undimensioned and skipped).
      width,
      height,
      style: { width, height },
    });

    ids.forEach((flowId, index) => {
      const flow = flows[flowId];
      if (!flow) return;
      nodes.push({
        id: `flow:${flowId}`,
        type: "flow",
        position: {
          x: padX,
          y: headerH + index * (NODE_BOX.flow.height + flowGap),
        },
        parentId: unitId,
        extent: "parent",
        zIndex: GRAPH_Z.leaf,
        data: {
          kind: "flow",
          label: actionOfFlowId(flowId),
          refId: flowId,
          unit,
          plane: flow.plane ?? "user",
          badge: flow.plane ?? "user",
        },
        draggable: false,
        width: NODE_BOX.flow.width,
        height: NODE_BOX.flow.height,
        style: { width: NODE_BOX.flow.width, height: NODE_BOX.flow.height },
      });
    });
  }

  const sortedTargets = [...targets.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  );
  for (const spec of sortedTargets) {
    const n = g.node(spec.id);
    const box = NODE_BOX[spec.kind];
    const count = effectCount.get(spec.id) ?? 0;
    nodes.push({
      id: spec.id,
      type: spec.kind,
      position: {
        x: (n?.x ?? 0) - box.width / 2,
        y: (n?.y ?? 0) - box.height / 2,
      },
      data: {
        kind: spec.kind,
        label: spec.label,
        refId: spec.id,
        ...(spec.facet !== undefined ? { facet: spec.facet } : {}),
        badge: spec.facet ?? (count > 0 ? String(count) : spec.kind),
      },
      draggable: false,
      zIndex: GRAPH_Z.leaf,
      width: box.width,
      height: box.height,
      style: { width: box.width, height: box.height },
    });
  }

  return nodes;
}

/** Extra per-node emphasis flags layered onto chain highlight. */
export interface ChainHighlightOptions {
  /** Node id pulsing during Replay playback. */
  readonly activeNodeId?: string | null;
  /** Node id emphasized by sticky sheet focus. */
  readonly focusedNodeId?: string | null;
}

/** Apply highlight/dim to nodes for a selected trace chain. */
export function applyChainHighlight(
  nodes: FlowGraphNode[],
  highlightedFlowIds: ReadonlySet<string>,
  highlightedNodeIds: ReadonlySet<string>,
  options: ChainHighlightOptions = {},
): FlowGraphNode[] {
  const active = highlightedFlowIds.size > 0 || highlightedNodeIds.size > 0;
  return nodes.map((node) => {
    if (node.data.kind === "unit" || node.data.kind === "law") return node;
    const isFlow = node.data.kind === "flow";
    const inChain = isFlow
      ? highlightedFlowIds.has(node.data.refId)
      : highlightedNodeIds.has(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        highlighted: inChain,
        dimmed: active && !inChain,
        active: options.activeNodeId != null && node.id === options.activeNodeId,
        focused: options.focusedNodeId != null && node.id === options.focusedNodeId,
      },
    };
  });
}

/**
 * Dim / emphasize edges to match the active chain without changing edge
 * topology (declared Manifest effects stay identical).
 */
export function applyEdgeHighlight(
  edges: readonly FlowGraphEdge[],
  nodes: readonly FlowGraphNode[],
): FlowGraphEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const active = nodes.some((n) => n.data.highlighted === true);
  if (!active) {
    return edges.map((edge) => ({
      ...edge,
      style: { ...edge.style, opacity: 1 },
    }));
  }

  return edges.map((edge) => {
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);
    const onChain = src?.data.highlighted === true && tgt?.data.highlighted === true;
    const stroke = EDGE_STROKE[edge.data?.kind ?? "reads"];
    return {
      ...edge,
      animated: onChain ? true : edge.animated,
      style: {
        ...edge.style,
        stroke,
        opacity: onChain ? 1 : 0.32,
        strokeWidth: onChain ? 2.75 : 1.75,
      },
      markerEnd:
        edge.markerEnd && typeof edge.markerEnd === "object"
          ? { ...edge.markerEnd, color: stroke }
          : edge.markerEnd,
    };
  });
}
