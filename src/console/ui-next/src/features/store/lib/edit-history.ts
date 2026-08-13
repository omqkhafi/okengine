/**
 * Undo/redo history for Store grid cell edits. Pure, immutable stacks — the
 * grid commits inverse patches to walk backwards.
 */

/** One committed cell change (values as read from / sent to the store). */
export interface CellUpdate {
  readonly rowId: string;
  readonly key: string;
  readonly prev: unknown;
  readonly next: unknown;
}

/** A group of cell updates committed together (edit, paste, clear, undo). */
export interface EditBatch {
  readonly updates: readonly CellUpdate[];
  readonly at: number;
}

/** Undo/redo stacks. `future` is cleared whenever a new batch is pushed. */
export interface EditHistory {
  readonly past: readonly EditBatch[];
  readonly future: readonly EditBatch[];
}

/** Empty history singleton. */
export const EMPTY_EDIT_HISTORY: EditHistory = { past: [], future: [] };

/** Push a committed batch, clearing the redo stack and capping depth. */
export function pushEditBatch(history: EditHistory, batch: EditBatch, cap = 100): EditHistory {
  const past = [...history.past, batch];
  return {
    past: past.length > cap ? past.slice(past.length - cap) : past,
    future: [],
  };
}

/** Move the newest past batch onto the redo stack. Null batch when empty. */
export function popUndo(history: EditHistory): { history: EditHistory; batch: EditBatch | null } {
  const batch = history.past[history.past.length - 1];
  if (!batch) return { history, batch: null };
  return {
    history: { past: history.past.slice(0, -1), future: [batch, ...history.future] },
    batch,
  };
}

/** Move the oldest redo batch back onto the past stack. Null batch when empty. */
export function popRedo(history: EditHistory): { history: EditHistory; batch: EditBatch | null } {
  const batch = history.future[0];
  if (!batch) return { history, batch: null };
  return {
    history: { past: [...history.past, batch], future: history.future.slice(1) },
    batch,
  };
}

/** Swap prev/next so a batch can be re-committed in reverse (undo). */
export function invertEditBatch(batch: EditBatch): EditBatch {
  return {
    at: batch.at,
    updates: batch.updates.map((u) => ({ ...u, prev: u.next, next: u.prev })),
  };
}
