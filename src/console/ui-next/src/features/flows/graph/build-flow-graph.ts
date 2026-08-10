/**
 * Manifest → React Flow graph (pure).
 *
 * Nodes: flows grouped by unit, plus the store / signal / AI targets each
 * flow's declared effects touch. Edges are declared (from the Manifest), not
 * runtime traffic.
 */

import type { Edge, Node } from "@xyflow/react";
import type { Flow, Manifest } from "../../../../../../manifest/types.ts";

/** Node kinds rendered by the Flow graph. */
export type FlowGraphNodeKind = "unit" | "flow" | "store" | "signal" | "ai";

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
  /** Dimmed when a trace chain is highlighted and this node is not in it. */
  readonly dimmed?: boolean;
  /** Emphasis ring when part of the highlighted chain. */
  readonly highlighted?: boolean;
};

export type FlowGraphNode = Node<FlowGraphNodeData>;

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

const UNIT_X = 0;
const FLOW_X = 40;
const TARGET_X = 560;
const ROW_H = 64;
const UNIT_HEADER_H = 40;
const UNIT_PAD = 16;

interface TargetSpec {
  readonly id: string;
  readonly kind: "store" | "signal" | "ai";
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
  if (ref.startsWith("signal:"))
    return { id: ref, kind: "signal", label: ref.slice(7) };
  if (ref.startsWith("ai:")) return { id: ref, kind: "ai", label: ref.slice(3) };
  return null;
}

/** Every effect ref a flow declares, with kind prefixes (legacy convention). */
function effectRefs(flow: Flow): string[] {
  const e = flow.effects;
  if (!e) return [];
  const refs: string[] = [];
  for (const r of e.reads ?? []) refs.push(r);
  for (const r of e.writes ?? []) refs.push(r);
  for (const s of e.emits ?? []) refs.push(`signal:${s}`);
  for (const a of e.asks ?? []) refs.push(`ai:${a}`);
  return refs;
}

/** Build React Flow nodes + edges from a Manifest snapshot. */
export function buildFlowGraph(manifest: Manifest | null | undefined): {
  readonly nodes: FlowGraphNode[];
  readonly edges: Edge[];
  readonly flowIds: ReadonlySet<string>;
} {
  const flows = manifest?.flows ?? {};
  const flowIds = new Set(Object.keys(flows));
  const nodes: FlowGraphNode[] = [];
  const edges: Edge[] = [];

  // Group flows by unit, preserving sorted order for determinism.
  const byUnit = new Map<string, string[]>();
  for (const flowId of [...flowIds].sort()) {
    const unit = unitOfFlowId(flowId);
    const list = byUnit.get(unit) ?? [];
    list.push(flowId);
    byUnit.set(unit, list);
  }

  const targets = new Map<string, TargetSpec>();
  const flowY = new Map<string, number>();
  let y = 0;

  for (const [unit, ids] of [...byUnit.entries()].sort()) {
    const unitHeight = UNIT_HEADER_H + ids.length * ROW_H + UNIT_PAD;
    nodes.push({
      id: `unit:${unit}`,
      type: "unit",
      position: { x: UNIT_X, y },
      data: { kind: "unit", label: unit, refId: `unit:${unit}` },
      selectable: false,
      draggable: false,
      style: { width: 460, height: unitHeight },
    });

    let innerY = UNIT_HEADER_H;
    for (const flowId of ids) {
      const flow = flows[flowId];
      if (!flow) continue;
      const absY = y + innerY;
      flowY.set(flowId, absY);
      nodes.push({
        id: `flow:${flowId}`,
        type: "flow",
        position: { x: FLOW_X, y: innerY },
        parentId: `unit:${unit}`,
        extent: "parent",
        data: {
          kind: "flow",
          label: actionOfFlowId(flowId),
          refId: flowId,
          unit,
          plane: flow.plane ?? "user",
        },
        draggable: false,
      });
      innerY += ROW_H;
    }
    y += unitHeight + 24;
  }

  // Collect targets + edges.
  for (const flowId of flowIds) {
    const flow = flows[flowId];
    if (!flow) continue;

    if (flow.trigger?.signal) {
      const ref = `signal:${flow.trigger.signal}`;
      const spec = targetFromRef(ref);
      if (spec) targets.set(ref, spec);
      edges.push({
        id: `e:${ref}->flow:${flowId}`,
        source: ref,
        target: `flow:${flowId}`,
        animated: false,
      });
    }

    for (const ref of effectRefs(flow)) {
      const spec = targetFromRef(ref);
      if (!spec) continue;
      targets.set(ref, spec);
      edges.push({
        id: `e:flow:${flowId}->${ref}`,
        source: `flow:${flowId}`,
        target: ref,
        animated: false,
      });
    }

    for (const callee of flow.effects?.calls ?? []) {
      edges.push({
        id: `e:flow:${flowId}->flow:${callee}`,
        source: `flow:${flowId}`,
        target: `flow:${callee}`,
        animated: true,
      });
    }
  }

  // Lay out targets in a right-hand column, sorted by kind then label.
  const sortedTargets = [...targets.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  );
  let ty = 0;
  for (const spec of sortedTargets) {
    nodes.push({
      id: spec.id,
      type: spec.kind,
      position: { x: TARGET_X, y: ty },
      data: {
        kind: spec.kind,
        label: spec.label,
        refId: spec.id,
        ...(spec.facet !== undefined ? { facet: spec.facet } : {}),
      },
      draggable: false,
    });
    ty += ROW_H;
  }

  return { nodes, edges, flowIds };
}

/** Apply highlight/dim to nodes for a selected trace chain. */
export function applyChainHighlight(
  nodes: FlowGraphNode[],
  highlightedFlowIds: ReadonlySet<string>,
  highlightedNodeIds: ReadonlySet<string>,
): FlowGraphNode[] {
  const active = highlightedFlowIds.size > 0 || highlightedNodeIds.size > 0;
  return nodes.map((node) => {
    if (node.data.kind === "unit") return node;
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
      },
    };
  });
}
