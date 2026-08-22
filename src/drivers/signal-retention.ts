/**
 * Live-tape retention — which history rows survive `maxAge` / `maxCount`.
 *
 * AND-combined when both are set. Omitted retention is unbounded.
 */

import { parseDurationMs } from "../elements/clock/duration.ts";
import type { SignalRetention } from "../elements/signal/declare.ts";

/** One live history row used to decide prune vs keep. */
export interface LiveRetentionRow {
  readonly id: string;
  readonly createdAt: number;
}

/**
 * Ids that fall outside {@link SignalRetention} (oldest first among drops).
 *
 * @param rows - Live rows for one signal
 * @param retention - Declared cap; omit or empty = keep all
 * @param now - Clock ms
 */
export function liveIdsToPrune(
  rows: readonly LiveRetentionRow[],
  retention: SignalRetention | undefined,
  now: number,
): string[] {
  if (retention === undefined) return [];
  const maxAge = retention.maxAge;
  const maxCount = retention.maxCount;
  if (maxAge === undefined && maxCount === undefined) return [];

  const indexed = rows.map((row, index) => ({ ...row, index }));
  const sorted = indexed.toSorted((a, b) => a.createdAt - b.createdAt || a.index - b.index);
  let keep = sorted;
  if (maxAge !== undefined) {
    const windowMs = parseDurationMs(maxAge);
    const cutoff = now - windowMs;
    keep = keep.filter((row) => row.createdAt >= cutoff);
  }
  if (maxCount !== undefined) {
    keep = keep.slice(-maxCount);
  }
  const keepIds = new Set(keep.map((row) => row.id));
  return sorted.filter((row) => !keepIds.has(row.id)).map((row) => row.id);
}

/**
 * Exclusive skip through `afterId` on a snapshot already ordered oldest-first.
 *
 * @param rows - Tape snapshot
 * @param afterId - SSE cursor; omit = full tape
 */
export function skipAfterId<T extends { readonly id: string }>(
  rows: readonly T[],
  afterId: string | undefined,
): { readonly found: boolean; readonly rest: readonly T[] } {
  if (afterId === undefined || afterId.length === 0) {
    return { found: true, rest: rows };
  }
  const idx = rows.findIndex((row) => row.id === afterId);
  if (idx < 0) return { found: false, rest: rows };
  return { found: true, rest: rows.slice(idx + 1) };
}
