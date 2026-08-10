/**
 * Causal chain across runs via `parentId` (same algorithm as legacy traces).
 */

import type { RunRow } from "@/client.ts";

/**
 * Flow ids touched by the causal chain containing `runId`.
 *
 * Walks ancestors via `parentId`, then descendants, across the known runs
 * buffer. Returns the ordered set of flow ids for graph highlighting.
 *
 * @param runs - Known runs
 * @param runId - Selected run id
 */
export function chainFlowIds(runs: readonly RunRow[], runId: string | null): Set<string> {
  const out = new Set<string>();
  if (!runId) return out;

  const byId = new Map<string, RunRow>();
  const childrenOf = new Map<string, RunRow[]>();
  for (const r of runs) {
    byId.set(r.id, r);
  }
  for (const r of runs) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r);
    childrenOf.set(r.parentId, list);
  }

  const current = byId.get(runId);
  if (!current) return out;

  // Ancestors (root → current).
  let cursor: RunRow | undefined = current;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    out.add(cursor.flow);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  // Descendants (BFS).
  const queue: RunRow[] = [current];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    for (const child of childrenOf.get(next.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.add(child.flow);
      queue.push(child);
    }
  }

  return out;
}
