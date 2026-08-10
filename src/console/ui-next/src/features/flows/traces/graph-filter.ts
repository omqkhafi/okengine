/**
 * Pure helpers for graph-driven Traces filtering.
 *
 * A click on a Flow graph node resolves to a {@link GraphFilter} that the
 * Traces pane applies on top of its existing status / duration / advanced
 * filters. Flow nodes map to the dimension query (`flow = X`); signal nodes
 * match runs whose flow emits or is triggered by that signal (the AND-only
 * dimension query cannot express that OR across flows).
 */

import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { matchesDimensionQuery, upsertClause, type DimensionQuery } from "./dimension-query.ts";

/** A filter derived from a graph node click. */
export type GraphFilter =
  | { readonly kind: "flow"; readonly flowId: string }
  | { readonly kind: "signal"; readonly signal: string };

/**
 * Resolve a clicked graph node id (`flow:bookings.create`, `signal:order-placed`)
 * into a {@link GraphFilter}. Returns `null` for node kinds that do not filter
 * the trace list (unit containers, stores, AI prompts).
 *
 * @param nodeId - React Flow node id
 */
export function graphFilterForNodeId(nodeId: string): GraphFilter | null {
  if (nodeId.startsWith("flow:")) {
    return { kind: "flow", flowId: nodeId.slice(5) };
  }
  if (nodeId.startsWith("signal:")) {
    return { kind: "signal", signal: nodeId.slice(7) };
  }
  return null;
}

/**
 * Apply a graph filter on top of the pane's existing advanced dimension query.
 *
 * Flow clicks upsert a `flow = X` clause into the shared advanced query so the
 * Advanced panel reflects the active filter. Signal clicks leave the dimension
 * query untouched (matched separately by {@link matchesGraphFilter}).
 *
 * @param query - Current advanced dimension query
 * @param filter - Graph filter (or `null` to clear the flow clause)
 */
export function applyGraphFilterToQuery(
  query: DimensionQuery,
  filter: GraphFilter | null,
): DimensionQuery {
  if (filter?.kind === "flow") {
    return upsertClause(query, { dimension: "flow", op: "=", value: filter.flowId });
  }
  return query;
}

/**
 * Whether a run matches a graph filter.
 *
 * - `flow`: the run's own flow id.
 * - `signal`: the run's flow emits the signal, or is triggered by it.
 *
 * @param run - Projected run row
 * @param filter - Graph filter
 * @param manifest - Manifest snapshot (for signal → flow resolution)
 */
export function matchesGraphFilter(
  run: RunRow,
  filter: GraphFilter,
  manifest: Manifest | null,
): boolean {
  if (filter.kind === "flow") {
    return matchesDimensionQuery(run, {
      clauses: [{ dimension: "flow", op: "=", value: filter.flowId }],
    });
  }
  const flows = manifest?.flows ?? {};
  for (const [flowId, flow] of Object.entries(flows)) {
    if (flowId !== run.flow) continue;
    if (flow.trigger?.signal === filter.signal) return true;
    if (flow.effects?.emits?.includes(filter.signal)) return true;
  }
  return false;
}

/**
 * Filter a run population by a graph filter (no-op when `null`).
 *
 * @param runs - Scoped runs
 * @param filter - Graph filter or `null`
 * @param manifest - Manifest snapshot
 */
export function filterRunsByGraph(
  runs: readonly RunRow[],
  filter: GraphFilter | null,
  manifest: Manifest | null,
): RunRow[] {
  if (!filter) return [...runs];
  return runs.filter((run) => matchesGraphFilter(run, filter, manifest));
}
