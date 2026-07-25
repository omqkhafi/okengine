/**
 * System boundary metric from Manifest external effects (console §9.13).
 *
 * Count is queried from declared `sends` / `asks` on the causality graph —
 * never hand-counted in the UI.
 */

import type { CausalityGraph } from "../flows/graph.ts";
import { isBoundaryExternal } from "./layers.ts";

/**
 * Distinct boundary-crossing external effects declared on flows.
 *
 * Watching this climb (2 → 9) is the security / architecture metric the
 * panel tracks — each unique channel or AI resource a flow touches.
 *
 * @param graph - Causality graph built by Flows (§9.1)
 */
export function boundaryCrossingCount(graph: CausalityGraph): number {
  const refs = new Set<string>();
  for (const flow of graph.flows) {
    for (const ref of flow.effectRefs) {
      if (isBoundaryExternal(ref)) refs.add(ref);
    }
  }
  return refs.size;
}

/**
 * Sorted list of distinct external effect refs that cross the boundary.
 *
 * @param graph - Causality graph
 */
export function boundaryCrossingRefs(graph: CausalityGraph): string[] {
  const refs = new Set<string>();
  for (const flow of graph.flows) {
    for (const ref of flow.effectRefs) {
      if (isBoundaryExternal(ref)) refs.add(ref);
    }
  }
  return [...refs].sort();
}
