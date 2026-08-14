/**
 * Pure helpers for graph-driven Traces filtering.
 *
 * A click on a Flow graph node resolves to a {@link GraphFilter} that the
 * Traces pane applies on top of its existing status / duration / advanced
 * filters. Flow nodes map to the dimension query (`flow = X`); unit nodes
 * map to `unit = X`. Signal / element / resource clicks match via Manifest
 * + ledger (the AND-only dimension query cannot express those ORs).
 */

import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { ELEMENT_ICONS, type OkeElement } from "@/lib/element-icons.ts";
import { unitOfFlowId } from "../graph/build-flow-graph.ts";
import { elementsOfRun } from "../graph/element-map.ts";
import { flowTouchesNode } from "../graph/neighborhood.ts";
import { matchesDimensionQuery, upsertClause, type DimensionQuery } from "./dimension-query.ts";

/** A filter derived from a graph node click. */
export type GraphFilter =
  | { readonly kind: "flow"; readonly flowId: string }
  | { readonly kind: "signal"; readonly signal: string }
  | { readonly kind: "unit"; readonly unit: string }
  | { readonly kind: "element"; readonly element: OkeElement }
  | { readonly kind: "resource"; readonly nodeId: string };

const OKE_ELEMENT_SET = new Set<string>(Object.keys(ELEMENT_ICONS));

/**
 * Resolve a clicked graph node id into a {@link GraphFilter}.
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
  if (nodeId.startsWith("unit:")) {
    return { kind: "unit", unit: nodeId.slice(5) };
  }
  if (nodeId.startsWith("element:")) {
    const element = nodeId.slice(8);
    if (OKE_ELEMENT_SET.has(element)) return { kind: "element", element: element as OkeElement };
    return null;
  }
  if (nodeId.startsWith("type:")) {
    const element = nodeId.slice(5).split(":")[0];
    if (element && OKE_ELEMENT_SET.has(element)) {
      return { kind: "element", element: element as OkeElement };
    }
    return null;
  }
  if (
    nodeId.startsWith("sql:") ||
    nodeId.startsWith("kv:") ||
    nodeId.startsWith("files:") ||
    nodeId.startsWith("index:") ||
    nodeId.startsWith("vault:") ||
    nodeId.startsWith("channel:") ||
    nodeId.startsWith("gate:") ||
    nodeId.startsWith("clock:") ||
    nodeId.startsWith("ai:")
  ) {
    return { kind: "resource", nodeId };
  }
  return null;
}

/**
 * Short label for the Traces graph-filter chip.
 *
 * @param filter - Active graph filter
 */
export function graphFilterLabel(filter: GraphFilter): string {
  switch (filter.kind) {
    case "flow":
      return filter.flowId;
    case "signal":
      return `signal:${filter.signal}`;
    case "unit":
      return filter.unit;
    case "element":
      return ELEMENT_ICONS[filter.element].label;
    case "resource":
      return filter.nodeId;
  }
}

/**
 * Apply a graph filter on top of the pane's existing advanced dimension query.
 *
 * Flow clicks upsert `flow = X`; unit clicks upsert `unit = X`. Other kinds
 * leave the dimension query untouched (matched by {@link matchesGraphFilter}).
 *
 * @param query - Current advanced dimension query
 * @param filter - Graph filter (or `null` to leave the query as-is)
 */
export function applyGraphFilterToQuery(
  query: DimensionQuery,
  filter: GraphFilter | null,
): DimensionQuery {
  if (filter?.kind === "flow") {
    return upsertClause(query, { dimension: "flow", op: "=", value: filter.flowId });
  }
  if (filter?.kind === "unit") {
    return upsertClause(query, { dimension: "unit", op: "=", value: filter.unit });
  }
  return query;
}

/**
 * Whether a run matches a graph filter.
 *
 * @param run - Projected run row
 * @param filter - Graph filter
 * @param manifest - Manifest snapshot (for signal / resource resolution)
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
  if (filter.kind === "unit") {
    return (run.unit ?? unitOfFlowId(run.flow)) === filter.unit;
  }
  if (filter.kind === "element") {
    if (filter.element === "flow") return true;
    return elementsOfRun(run).includes(filter.element);
  }
  if (filter.kind === "resource") {
    return runTouchesResource(run, filter.nodeId, manifest);
  }
  const flows = manifest?.flows ?? {};
  for (const [flowId, flow] of Object.entries(flows)) {
    if (flowId !== run.flow) continue;
    if (flow.trigger?.signal === filter.signal) return true;
    if (flow.effects?.emits?.includes(filter.signal)) return true;
  }
  return false;
}

function runTouchesResource(run: RunRow, nodeId: string, manifest: Manifest | null): boolean {
  const suffix = nodeId.includes(":") ? nodeId.slice(nodeId.indexOf(":") + 1) : nodeId;
  if (run.effects.some((effect) => effect.resource === nodeId || effect.resource === suffix)) {
    return true;
  }
  if (run.gates.some((name) => nodeId === `gate:${name}`)) return true;
  const flow = manifest?.flows?.[run.flow];
  if (flow && flowTouchesNode(flow, run.flow, nodeId)) return true;
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
