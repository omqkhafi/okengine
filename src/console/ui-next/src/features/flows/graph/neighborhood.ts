/**
 * 1-hop neighborhood — the detailed node-link graph, scoped so it stays
 * traceable. Overview (units ↔ eight elements) lives in `element-map.ts`.
 */

import type { Flow, Manifest } from "../../../../../../manifest/types.ts";
import { unitOfFlowId } from "./build-flow-graph.ts";

/** Focus that expands the detailed graph (not the bipartite map). */
export type NeighborhoodFocus =
  | { readonly kind: "unit"; readonly unit: string }
  | { readonly kind: "flow"; readonly flowId: string }
  | { readonly kind: "resource"; readonly nodeId: string };

/**
 * Slice a Manifest to the flows in a neighborhood so `buildFlowGraph`
 * lays out a small, traceable graph.
 *
 * @param manifest - Live Manifest
 * @param focus - Unit, flow, or resource
 */
export function sliceManifestForFocus(manifest: Manifest, focus: NeighborhoodFocus): Manifest {
  const flows = manifest.flows ?? {};
  const keep = new Set<string>();

  if (focus.kind === "unit") {
    for (const flowId of Object.keys(flows)) {
      if (unitOfFlowId(flowId) === focus.unit) keep.add(flowId);
    }
    const callees: string[] = [];
    for (const flowId of keep) {
      for (const callee of flows[flowId]?.effects?.calls ?? []) callees.push(callee);
    }
    for (const callee of callees) keep.add(callee);
  } else if (focus.kind === "flow") {
    keep.add(focus.flowId);
    const flow = flows[focus.flowId];
    for (const callee of flow?.effects?.calls ?? []) keep.add(callee);
    for (const [id, other] of Object.entries(flows)) {
      if (other.effects?.calls?.includes(focus.flowId)) keep.add(id);
    }
  } else {
    for (const [flowId, flow] of Object.entries(flows)) {
      if (flowTouchesNode(flow, flowId, focus.nodeId)) keep.add(flowId);
    }
  }

  const sliced: Record<string, Flow> = {};
  for (const id of keep) {
    const flow = flows[id];
    if (flow) sliced[id] = flow;
  }
  return { ...manifest, flows: sliced };
}

/**
 * Whether a flow declares a relationship to a graph node id.
 *
 * @param flow - Manifest flow
 * @param flowId - Flow id (clock nodes are keyed by it)
 * @param nodeId - React Flow node id
 */
export function flowTouchesNode(flow: Flow, flowId: string, nodeId: string): boolean {
  if (nodeId === `flow:${flowId}`) return true;
  if (nodeId === `clock:${flowId}` && (flow.trigger?.cron || flow.trigger?.every)) return true;
  if (flow.trigger?.signal && nodeId === `signal:${flow.trigger.signal}`) return true;
  if (flow.gates?.some((name) => nodeId === `gate:${name}`)) return true;
  const effects = flow.effects;
  if (!effects) return false;
  if (
    effects.reads?.some((ref) => ref === nodeId) ||
    effects.writes?.some((ref) => ref === nodeId)
  ) {
    return true;
  }
  if (effects.emits?.some((name) => nodeId === `signal:${name}`)) return true;
  if (effects.sends?.some((name) => nodeId === `channel:${name}`)) return true;
  if (effects.asks?.some((name) => nodeId === `ai:${name}`)) return true;
  if (effects.secrets?.some((name) => nodeId === `vault:${name}`)) return true;
  if (effects.calls?.some((callee) => nodeId === `flow:${callee}`)) return true;
  return false;
}
