/**
 * Cache sub-view — surfaces effects-derived invalidation (console §9.5).
 *
 * Does not recompute invalidation rules; projects what Store already knows.
 */

import type { StoreCacheView, StoreChild } from "./types.ts";

/** Operator-facing cache explanation. */
export interface CacheExplanation {
  readonly producedByRead: string;
  readonly invalidatedBy: readonly string[];
  readonly invalidatingFlows: readonly string[];
  readonly summary: string;
}

/**
 * Explain which read produced a key and which writes invalidate it.
 *
 * @param child - Child resource with cache projection
 */
export function explainCache(child: StoreChild): CacheExplanation {
  const view: StoreCacheView = child.cache;
  const invalidators = view.invalidatedByWrites;
  const flows = view.invalidatingFlowIds;
  const summary =
    invalidators.length === 0
      ? `Read key \`${view.producedByRead}\` — no write invalidators declared.`
      : `Read key \`${view.producedByRead}\` — invalidated by writes to ${invalidators.map((r) => `\`${r}\``).join(", ")}.`;
  return {
    producedByRead: view.producedByRead,
    invalidatedBy: invalidators,
    invalidatingFlows: flows,
    summary,
  };
}
