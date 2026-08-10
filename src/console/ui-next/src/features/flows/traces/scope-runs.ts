/**
 * Scope the runs buffer to flows currently present on the graph.
 */

import type { RunRow } from "@/client.ts";

const MAX_ROWS = 100;

/**
 * Recent runs whose `flow` is in `visibleFlowIds`, newest first.
 *
 * @param runs - Full runs buffer
 * @param visibleFlowIds - Flow ids present as graph nodes
 */
export function scopeRunsToFlows(
  runs: readonly RunRow[],
  visibleFlowIds: ReadonlySet<string>,
): RunRow[] {
  return runs
    .filter((r) => visibleFlowIds.has(r.flow))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_ROWS);
}
