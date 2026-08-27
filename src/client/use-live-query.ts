/**
 * Live query client core — reducer + snapshot/SSE ordering primitives.
 *
 * Framework-agnostic so React (`useLiveQuery` in `client-react`) and other
 * renderers share one implementation. The wire taxonomy mirrors the server's
 * `LiveQueryEvent` exactly: classified per-subscriber RLS verdicts pushed
 * directly per subscriber (never a shared tape).
 *
 * @module
 */

/** Wire event kinds served by a resource live route (`GET <path>/live`). */
export type LiveQueryEvent<Row = Record<string, unknown>> =
  | {
      readonly kind: "upsert";
      readonly row: Row;
      readonly seq?: number;
      /** Echoed `X-Oke-Mutation-Id` — identifies the write that caused it. */
      readonly mutationId?: string;
    }
  | {
      readonly kind: "revoked";
      readonly id: string;
      readonly reason: "rls" | "query";
      readonly seq?: number;
    }
  | { readonly kind: "delete"; readonly id: string; readonly seq?: number };

/** Error codes surfaced on `error` in hook state. */
export type LiveQueryError =
  | { readonly kind: "initial"; readonly error: unknown }
  | { readonly kind: "connection"; readonly error: unknown };

/** Field names probed for LWW guards when no explicit `versionOf` is given. */
const VERSION_FIELD_CANDIDATES = ["updatedAt", "updated_at", "version"] as const;

/**
 * Pure row-list reducer for the three event kinds.
 *
 * - `upsert` → replace-or-append by PK (optimistic overrides re-applied)
 * - `revoked` / `delete` → remove by PK (silent staleness impossible)
 *
 * @param rows - Current row list
 * @param idOf - Primary-key extractor
 * @param event - Classified server event
 * @param overrides - Optimistic patches keyed by PK
 */
export function reduceLiveQueryRows<Row>(
  rows: readonly Row[],
  idOf: (row: Row) => string,
  event: LiveQueryEvent<Row>,
  overrides?: ReadonlyMap<string, Partial<Row>>,
): Row[] {
  if (event.kind === "upsert") {
    const id = idOf(event.row);
    const patch = overrides?.get(id);
    const patched = patch !== undefined ? ({ ...event.row, ...patch } as Row) : event.row;
    const idx = rows.findIndex((r) => idOf(r) === id);
    if (idx === -1) return [...rows, patched];
    const next = [...rows];
    next[idx] = patched;
    return next;
  }
  return rows.filter((r) => idOf(r) !== event.id);
}

/**
 * Idempotence guard for replayed SSE events: drop anything at or below the
 * highest sequence number already applied for this subscription (Realtime
 * correctness contract — reconnect replay must not double-apply). Events
 * without a `seq` always apply.
 *
 * @param lastAppliedSeq - Highest seq applied so far (`0` = none)
 * @param event - Incoming classified event
 * @returns True when the event must be ignored
 */
export function isReplayedEvent(
  lastAppliedSeq: number,
  event: { readonly kind: string; readonly seq?: number },
): boolean {
  return event.seq !== undefined && event.seq <= lastAppliedSeq;
}

/**
 * LWW guard between an existing row image and an incoming event row.
 *
 * True when `incoming` is provably older: both sides expose a comparable
 * version field (`versionOf` override, else `updatedAt`/`updated_at`/
 * `version`) and `existing >= incoming`. Uncomparable → never stale.
 *
 * @param existing - Row currently held client-side
 * @param incoming - Row carried by the CDC upsert
 * @param versionOf - Optional explicit version extractor
 */
export function isStaleUpsert<Row>(
  existing: Row,
  incoming: Row,
  versionOf?: ((row: Row) => number | string | null) | undefined,
): boolean {
  const extract =
    versionOf ??
    ((row: Row): number | string | null => {
      const bag = row as Record<string, unknown>;
      for (const f of VERSION_FIELD_CANDIDATES) {
        const v = bag[f];
        if (typeof v === "number" || typeof v === "string") return v;
      }
      return null;
    });
  const a = extract(existing);
  const b = extract(incoming);
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") return a >= b;
  // ISO-ish strings compare lexicographically; mixed kinds fall back safe.
  if (typeof a === "string" && typeof b === "string") return a >= b;
  return false;
}

/**
 * Reconcile one row into the optimistic override map.
 *
 * The map only carries the fields the caller patched, so a later server
 * upsert re-applies them over the possibly-older wire image. Cleared when a
 * PK round-trips (confirm from response or CDC) or rolls back on error.
 *
 * @param current - Existing override map (or `undefined`)
 * @param id - Row PK
 * @param patch - Fields to overlay
 */
export function applyOptimisticPatch<Row>(
  current: ReadonlyMap<string, Partial<Row>> | undefined,
  id: string,
  patch: Partial<Row>,
): ReadonlyMap<string, Partial<Row>> {
  const next = new Map(current ?? []);
  next.set(id, { ...(next.get(id) ?? {}), ...patch });
  return next;
}

/**
 * Drop overrides for ids confirmed gone (delete/revoked, failed mutation).
 *
 * @param current - Override map
 * @param removedIds - Ids to clear
 */
export function clearOptimisticPatch<Row>(
  current: ReadonlyMap<string, Partial<Row>> | undefined,
  removedIds: readonly string[],
): ReadonlyMap<string, Partial<Row>> {
  if (!current || removedIds.length === 0) return current ?? new Map();
  const next = new Map(current);
  for (const id of removedIds) next.delete(id);
  return next;
}
