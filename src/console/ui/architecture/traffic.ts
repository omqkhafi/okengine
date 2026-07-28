/**
 * Observed edge traffic from Runs (console §9.13).
 *
 * Edge thickness is real traffic, not declaration. A dashed edge is
 * declared in code and never traversed.
 */

import type { EffectKind } from "../../../kernel/effects.ts";
import type { RunRecord } from "../runs/types.ts";

/**
 * Normalise a recorded effect resource to the causality effect-ref form.
 *
 * @param kind - Effect kind from the run ledger
 * @param resource - Raw resource string on the run
 */
export function normalizeTrafficRef(kind: EffectKind, resource: string): string {
  switch (kind) {
    case "emit":
      return resource.startsWith("signal:") ? resource : `signal:${resource}`;
    case "send":
      return resource.startsWith("channel:") ? resource : `channel:${resource}`;
    case "ask":
      return resource.startsWith("ai:") ? resource : `ai:${resource}`;
    case "secret":
      return resource.startsWith("secret:") ? resource : `secret:${resource}`;
    case "call":
      return resource.startsWith("flow:") ? resource : `flow:${resource}`;
    default:
      return resource;
  }
}

/**
 * Stable key for a flow → resource relationship.
 *
 * @param flowId - Flow id
 * @param ref - Normalised effect ref
 */
export function trafficEdgeKey(flowId: string, ref: string): string {
  return `${flowId}\0${ref}`;
}

/**
 * Count observed traversals of each declared flow→resource edge from Runs.
 *
 * @param runs - Wide-event population
 */
export function observeTraffic(runs: readonly RunRecord[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const effect of run.effects) {
      const ref = normalizeTrafficRef(effect.kind, effect.resource);
      const key = trafficEdgeKey(run.flow, ref);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Flow invocation itself counts as traversal of call edges into this flow
    // when a parent exists — parent.flow → flow:run.flow
    if (run.parentId) {
      // Parent resolution is optional; call traffic is also recorded as effects.
    }
  }
  return counts;
}

/**
 * Look up traversals for a flow→resource edge.
 *
 * @param traffic - Observed map
 * @param flowId - Flow id
 * @param ref - Effect ref
 */
export function traversalsOf(
  traffic: ReadonlyMap<string, number>,
  flowId: string,
  ref: string,
): number {
  return traffic.get(trafficEdgeKey(flowId, ref)) ?? 0;
}

/**
 * Map absolute traversal counts to stroke thickness 1–8.
 *
 * @param traversals - Observed count
 * @param maxTraversals - Max among visible edges (for relative scale)
 */
export function thicknessOf(traversals: number, maxTraversals: number): number {
  if (traversals <= 0) return 1;
  if (maxTraversals <= 1) return 2;
  const ratio = traversals / maxTraversals;
  return Math.max(1, Math.min(8, Math.ceil(ratio * 8)));
}
