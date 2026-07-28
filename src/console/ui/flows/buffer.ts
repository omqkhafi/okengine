/**
 * New-rows buffer — never move the ground (console §7.2 law 1).
 *
 * Incoming rows accumulate behind a "N new" pill and never push existing ones.
 * Flushing prepends them in a single transition the operator controls.
 */

/** Buffered row with stable identity. */
export interface BufferedRow<T> {
  /** Stable id. */
  readonly id: string;
  /** Payload. */
  readonly value: T;
  /** Arrival timestamp (ms). */
  readonly arrivedAt: number;
}

/** Mutable new-rows buffer. */
export interface RowBuffer<T> {
  /** Rows currently visible (stable order). */
  readonly visible: readonly BufferedRow<T>[];
  /** Rows waiting behind the pill. */
  readonly pending: readonly BufferedRow<T>[];
  /** Count shown on the pill. */
  readonly pendingCount: number;
  /**
   * Offer a new row. If it already exists in visible/pending, update in place.
   * Otherwise buffer it (does not push visible rows).
   *
   * @param row - Incoming row
   */
  offer(row: BufferedRow<T>): void;
  /**
   * Update an existing visible row in place (no reflow of siblings).
   *
   * @param id - Row id
   * @param value - New value
   */
  updateInPlace(id: string, value: T): boolean;
  /** Flush pending rows to the front of the visible list. */
  flush(): void;
  /** Discard pending without applying. */
  discardPending(): void;
}

/**
 * Create a new-rows buffer.
 *
 * @param initial - Initial visible rows
 */
export function createRowBuffer<T>(initial: readonly BufferedRow<T>[] = []): RowBuffer<T> {
  const visible: BufferedRow<T>[] = [...initial];
  const pending: BufferedRow<T>[] = [];

  const findVisible = (id: string): number => visible.findIndex((r) => r.id === id);
  const findPending = (id: string): number => pending.findIndex((r) => r.id === id);

  return {
    get visible() {
      return visible;
    },
    get pending() {
      return pending;
    },
    get pendingCount() {
      return pending.length;
    },
    offer(row: BufferedRow<T>): void {
      const vi = findVisible(row.id);
      if (vi >= 0) {
        visible[vi] = row;
        return;
      }
      const pi = findPending(row.id);
      if (pi >= 0) {
        pending[pi] = row;
        return;
      }
      pending.push(row);
    },
    updateInPlace(id: string, value: T): boolean {
      const vi = findVisible(id);
      if (vi < 0) return false;
      const prev = visible[vi];
      if (!prev) return false;
      visible[vi] = { ...prev, value };
      return true;
    },
    flush(): void {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      visible.unshift(...batch);
    },
    discardPending(): void {
      pending.length = 0;
    },
  };
}

/**
 * Dim-never-hide match: returns whether a row matches the query.
 * Callers keep non-matches in the DOM at reduced opacity.
 *
 * @param haystack - Fields to search
 * @param query - Free-text query
 */
export function matchesQuery(haystack: readonly string[], query: string | undefined): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => h.toLowerCase().includes(q));
}
