/**
 * Cross-links between Runs (population) and Traces (causal chain).
 */

import type { RunRecord } from "./types.ts";

/**
 * Walk parentId links to the root of a run's causal chain.
 *
 * @param runs - Population (must include ancestors)
 * @param runId - Starting run id
 */
export function rootIdOf(runs: readonly RunRecord[], runId: string): string {
  const byId = new Map(runs.map((r) => [r.id, r]));
  let cursor = byId.get(runId);
  if (!cursor) return runId;
  const seen = new Set<string>();
  while (cursor.parentId && byId.has(cursor.parentId)) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    cursor = byId.get(cursor.parentId)!;
  }
  return cursor.id;
}

/**
 * Count spans in the connected component rooted at {@link rootId}.
 *
 * @param runs - Population
 * @param rootId - Trace root id
 */
export function spanCountInTrace(runs: readonly RunRecord[], rootId: string): number {
  const byId = new Map(runs.map((r) => [r.id, r]));
  if (!byId.has(rootId)) return 0;
  const childrenOf = new Map<string, string[]>();
  for (const r of runs) {
    if (!r.parentId || !byId.has(r.parentId)) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentId, list);
  }
  let count = 0;
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    count += 1;
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return count;
}

/**
 * Whether opening this run should offer "Open in Traces"
 * (trace has more than one span).
 *
 * @param runs - Population
 * @param runId - Selected run
 */
export function shouldOfferTracesLink(runs: readonly RunRecord[], runId: string): boolean {
  const root = rootIdOf(runs, runId);
  return spanCountInTrace(runs, root) > 1;
}

/**
 * Build the Traces panel href for a run.
 *
 * @param runs - Population
 * @param runId - Selected run (becomes focus span)
 */
export function tracesHrefForRun(runs: readonly RunRecord[], runId: string): string {
  const root = rootIdOf(runs, runId);
  const params = new URLSearchParams({ trace: root, span: runId });
  return `/traces?${params.toString()}`;
}

/**
 * Build the Runs panel href for a span.
 *
 * @param runId - Span / run id
 */
export function runsHrefForSpan(runId: string): string {
  const params = new URLSearchParams({ run: runId });
  return `/runs?${params.toString()}`;
}
