/**
 * Uncommitted Store grid edits — stage locally, apply as one batch.
 */

import type { CellUpdate } from "./edit-history.ts";
import { rangeCoords, type CellRange } from "./cell-selection.ts";

/** One staged cell, keyed by {@link pendingKey}. */
export interface PendingCell {
  readonly rowId: string;
  readonly key: string;
  readonly prev: unknown;
  readonly next: unknown;
}

/** Clipboard paste landing on a writable cell. */
export interface PasteHit {
  readonly rowId: string;
  readonly key: string;
  readonly text: string;
}

/**
 * Stable map key for a staged cell.
 *
 * @param rowId - Grid row id
 * @param key - Column key
 */
export function pendingKey(rowId: string, key: string): string {
  return `${rowId}\0${key}`;
}

/**
 * Stage or drop a cell. Writing the original value back removes the entry.
 *
 * @param pending - Current map
 * @param log - Stage order (last write wins, key moved to end)
 * @param cell - Candidate edit
 */
export function stagePending(
  pending: ReadonlyMap<string, PendingCell>,
  log: readonly string[],
  cell: PendingCell,
): { readonly pending: Map<string, PendingCell>; readonly log: string[] } {
  const next = new Map(pending);
  const key = pendingKey(cell.rowId, cell.key);
  const rest = log.filter((k) => k !== key);
  if (Object.is(cell.prev, cell.next)) {
    next.delete(key);
    return { pending: next, log: rest };
  }
  next.set(key, cell);
  return { pending: next, log: [...rest, key] };
}

/**
 * Drop the most recently staged cell. Null when the log is empty.
 *
 * @param pending - Current map
 * @param log - Stage order
 */
export function popPending(
  pending: ReadonlyMap<string, PendingCell>,
  log: readonly string[],
): {
  readonly pending: Map<string, PendingCell>;
  readonly log: string[];
  readonly popped: PendingCell | null;
} {
  const key = log[log.length - 1];
  if (key === undefined) {
    return { pending: new Map(pending), log: [...log], popped: null };
  }
  const popped = pending.get(key) ?? null;
  const next = new Map(pending);
  next.delete(key);
  return { pending: next, log: log.slice(0, -1), popped };
}

/**
 * Flatten staged cells into a commit batch (row-major by log order, unique keys).
 *
 * @param pending - Current map
 */
export function pendingToUpdates(pending: ReadonlyMap<string, PendingCell>): CellUpdate[] {
  return [...pending.values()].map((cell) => ({
    rowId: cell.rowId,
    key: cell.key,
    prev: cell.prev,
    next: cell.next,
  }));
}

/**
 * Map a TSV matrix onto target rows starting at `startCol`.
 *
 * Multi-row selection tiles the clipboard (Excel fill). A taller clipboard
 * than the selection is clipped. Non-writable cells consume a column slot
 * so later values stay aligned.
 *
 * @param options - Matrix + target row ids + column keys
 */
export function pasteHits(options: {
  readonly matrix: readonly (readonly string[])[];
  readonly rowIds: readonly string[];
  readonly columnKeys: readonly string[];
  readonly startCol: number;
  readonly writable: (rowId: string, key: string) => boolean;
}): PasteHit[] {
  const { matrix, rowIds, columnKeys, writable } = options;
  if (matrix.length === 0 || rowIds.length === 0 || columnKeys.length === 0) return [];
  const startCol = Math.max(0, Math.min(options.startCol, columnKeys.length - 1));
  const hits: PasteHit[] = [];
  for (let r = 0; r < rowIds.length; r++) {
    const rowId = rowIds[r];
    const line = matrix[r % matrix.length];
    if (!rowId || !line) continue;
    for (let c = 0; c < line.length; c++) {
      const key = columnKeys[startCol + c];
      if (!key) continue;
      if (!writable(rowId, key)) continue;
      hits.push({ rowId, key, text: line[c] ?? "" });
    }
  }
  return hits;
}

/**
 * Fill every writable cell in a rectangular range with the same text.
 *
 * @param options - Range over visible row ids / column keys
 */
export function fillHits(options: {
  readonly range: CellRange;
  readonly rowIds: readonly string[];
  readonly columnKeys: readonly string[];
  readonly text: string;
  readonly writable: (rowId: string, key: string) => boolean;
}): PasteHit[] {
  const { range, rowIds, columnKeys, text, writable } = options;
  const hits: PasteHit[] = [];
  for (const coord of rangeCoords(range)) {
    const rowId = rowIds[coord.row];
    const key = columnKeys[coord.col];
    if (!rowId || !key) continue;
    if (!writable(rowId, key)) continue;
    hits.push({ rowId, key, text });
  }
  return hits;
}
