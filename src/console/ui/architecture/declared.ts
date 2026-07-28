/**
 * Declared architecture edges derived from the Flows causality graph (§9.1 / §9.13).
 *
 * Reuses {@link buildCausalityGraph} output — does not recompute causality.
 */

import type { CausalityGraph, FlowNode } from "../flows/graph.ts";
import { isBoundaryExternal, layerOfCause, layerOfEffectRef } from "./layers.ts";
import type { ElementLayer } from "./types.ts";

/** One fine-grained declared relationship before aggregation / focus. */
export interface DeclaredEdge {
  /** Source node id (flow: / unit: / cause:). */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /** Owning flow that declares the relationship (for traffic lookup). */
  readonly flowId: string;
  /** Effect ref when the target is a resource. */
  readonly ref?: string;
  /** Typed layer, or structural call. */
  readonly layer: ElementLayer | "call";
  /** Source unit. */
  readonly fromUnit: string;
  /** Target unit (`external` for boundary-crossing resources). */
  readonly toUnit: string;
}

/**
 * Extract every declared typed edge from the causality graph.
 *
 * @param graph - Flows causality graph
 */
export function declaredEdgesOf(graph: CausalityGraph): DeclaredEdge[] {
  const edges: DeclaredEdge[] = [];
  const consumersOf = signalConsumers(graph);

  for (const flow of graph.flows) {
    // Cause → flow (time / messaging triggers)
    for (const causeId of flow.causeIds) {
      const cause = graph.causeById.get(causeId);
      if (!cause) continue;
      const layer = layerOfCause(cause);
      if (!layer) continue;
      edges.push({
        from: `cause:${cause.id}`,
        to: `flow:${flow.id}`,
        flowId: flow.id,
        layer,
        fromUnit: flow.unit,
        toUnit: flow.unit,
      });
    }

    // Flow → resources / callees
    for (const ref of flow.effectRefs) {
      if (ref.startsWith("flow:")) {
        const callee = ref.slice("flow:".length);
        const calleeUnit = unitOfFlowId(callee);
        edges.push({
          from: `flow:${flow.id}`,
          to: `flow:${callee}`,
          flowId: flow.id,
          ref,
          layer: "call",
          fromUnit: flow.unit,
          toUnit: calleeUnit,
        });
        continue;
      }

      const layer = layerOfEffectRef(ref);
      if (!layer) continue;

      const toUnit = isBoundaryExternal(ref) ? "external" : ownerUnitOf(ref, graph);
      edges.push({
        from: `flow:${flow.id}`,
        to: ref,
        flowId: flow.id,
        ref,
        layer,
        fromUnit: flow.unit,
        toUnit,
      });

      // Messaging fan-out: emitter unit → consumer units
      if (layer === "messaging" && ref.startsWith("signal:")) {
        const sig = ref.slice("signal:".length);
        for (const consumerId of consumersOf.get(sig) ?? []) {
          const consumer = graph.flowById.get(consumerId);
          if (!consumer || consumer.id === flow.id) continue;
          edges.push({
            from: `flow:${flow.id}`,
            to: `flow:${consumer.id}`,
            flowId: flow.id,
            ref,
            layer: "messaging",
            fromUnit: flow.unit,
            toUnit: consumer.unit,
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Unit that "owns" a resource for clustering (first writing/emitting flow's unit,
 * else first touching unit, else `shared`).
 *
 * @param ref - Effect ref
 * @param graph - Causality graph
 */
export function ownerUnitOf(ref: string, graph: CausalityGraph): string {
  const effect = graph.effectByRef.get(ref);
  if (!effect || effect.flowIds.length === 0) return "shared";

  const writers = effect.flowIds.filter((id) => {
    const flow = graph.flowById.get(id);
    if (!flow) return false;
    return flowWritesOrEmits(flow, ref);
  });
  const pick = writers[0] ?? effect.flowIds[0];
  if (!pick) return "shared";
  return unitOfFlowId(pick);
}

function flowWritesOrEmits(flow: FlowNode, ref: string): boolean {
  const effects = flow.raw.effects;
  if (!effects) return false;
  if (ref.startsWith("signal:")) {
    const name = ref.slice("signal:".length);
    return (effects.emits ?? []).includes(name);
  }
  if ((effects.writes ?? []).includes(ref)) return true;
  return false;
}

function signalConsumers(graph: CausalityGraph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const flow of graph.flows) {
    const sig = flow.raw.trigger?.signal;
    if (!sig) continue;
    const list = map.get(sig) ?? [];
    list.push(flow.id);
    map.set(sig, list);
  }
  return map;
}

/**
 * Unit prefix of a flow id.
 *
 * @param flowId - Flow id
 */
export function unitOfFlowId(flowId: string): string {
  const i = flowId.indexOf(".");
  return i === -1 ? flowId : flowId.slice(0, i);
}
