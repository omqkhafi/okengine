/**
 * `useLiveQuery` — live list state + optimistic mutate over a resource.
 *
 * Grounded in existing client contracts: the initial load calls the list
 * Flow ({@link ClientCall} envelope), updates ride the synthesized SSE route
 * (`GET <path>/live`, classified per-subscriber RLS events), and `mutate`
 * wraps any {@link ClientCall} with snapshot → optimistic patch →
 * rollback-on-error physics. The server stays authoritative; the client only
 * projects CDC verdicts.
 *
 * Ordering protocol (snapshot/SSE race): the stream is opened BEFORE the
 * list request, and its events buffer until the snapshot lands. Buffered
 * upserts merge into the snapshot; deletes/revokes are tombstoned so rows
 * removed mid-load never reappear from the snapshot. After replay every
 * later event applies directly.
 *
 * Reconnect heals by full list refetch — classified events are
 * per-connection, so there is no tape cursor to resume from.
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transportOf } from "../client/create.ts";
import type { ClientCall, ClientResult } from "../client/types.ts";
import {
  applyOptimisticPatch,
  clearOptimisticPatch,
  isStaleUpsert,
  reduceLiveQueryRows,
  type LiveQueryError,
  type LiveQueryEvent,
} from "../client/use-live-query.ts";
import { subscribeLiveResource, type ResourceStreamOptions } from "./live-resource.ts";

/** Resource live route descriptor — the `$routes` stamp on `_live_<table>`. */
export interface LiveRouteContract {
  readonly method: string;
  readonly path: string;
}

/**
 * Options for {@link useLiveQuery}.
 *
 * @typeParam Row - Row shape
 */
export interface UseLiveQueryOptions<Row> {
  /** Primary-key extractor. Default `row.id`. */
  readonly idOf?: (row: Row) => string;
  /** Version extractor for stale-guarding server upserts against held rows. */
  readonly versionOf?: (row: Row) => number | string | null;
  /**
   * Reactive key guarding the subscription (identity/token changes).
   * Changing it resets everything and refetches.
   */
  readonly refreshKey?: string | number;
}

/**
 * Live query state + imperative mutation.
 *
 * @typeParam Row - Row shape
 */
export interface UseLiveQueryState<Row> {
  /** Merged rows (`null` until the first snapshot lands). */
  readonly data: readonly Row[] | null;
  /** Initial-load failure (`initial`) or last stream failure (`connection`). */
  readonly error: LiveQueryError | null;
  readonly isLoading: boolean;
  readonly isConnected: boolean;
  /**
   * Optimistic mutation wrapping an existing Flow call.
   *
   * Snapshot → patch via `optimistic(rows)` → call → rollback on error. On
   * success the touched PKs (from `pkFromResult` / `pkOf`) stop carrying the
   * optimistic patch, so real CDC upserts replace the local image cleanly.
   * Omitting `optimistic` skips local patching entirely; server CDC updates
   * the list anyway.
   *
   * @param flow - Any typed Flow call (e.g. `api.tasks.update`)
   * @param input - Flow input (`{ id, ...patch }`)
   * @param options - Optimistic projection + PK sources for override clears
   */
  mutate<X, Y, M extends Record<string, unknown>>(
    flow: ClientCall<X, Y, M>,
    input: X,
    options?: {
      readonly optimistic?: (rows: readonly Row[]) => readonly Row[];
      readonly pkOf?: (input: X) => string;
      readonly pkFromResult?: (data: Y) => string | undefined;
    },
  ): Promise<ClientResult<Y, M>>;
}

/**
 * Subscribe a component to one resource's live query stack.
 *
 * @param args.api - Typed client from `createClient`
 * @param args.listFlow - The resource's list call (`api.tasks.list`)
 * @param args.query - Same input as the list Flow (filters)
 * @param args.live - SSE route from `$routes`
 * @param args.options - PK/version extractors, refresh key
 */
export function useLiveQuery<Row extends Record<string, unknown>, I = void>(args: {
  readonly api: object;
  readonly listFlow: ClientCall<I, Row[], Record<string, never>>;
  readonly query?: I;
  readonly live: LiveRouteContract;
  readonly options?: UseLiveQueryOptions<Row>;
}): UseLiveQueryState<Row> {
  const { api, listFlow, query, live, options } = args;
  const opts = options ?? {};
  const defaultIdOf = useCallback((row: Row) => String((row as Record<string, unknown>).id), []);
  const idOf = opts.idOf ?? defaultIdOf;

  const queryKey = JSON.stringify(query ?? null);
  const refreshKey = opts.refreshKey;

  const [data, setData] = useState<readonly Row[] | null>(null);
  const [error, setError] = useState<LiveQueryError | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isConnected, setConnected] = useState(false);

  // Refs mirror state so streaming/mutate callbacks read latest without
  // resubscribing.
  const dataRef = useRef<readonly Row[] | null>(null);
  dataRef.current = data;
  const idOfRef = useRef(idOf);
  idOfRef.current = idOf;
  const overridesRef = useRef<ReadonlyMap<string, Partial<Row>>>(new Map());
  const [overridesVersion, setOverridesVersion] = useState(0);
  const bumpOverrides = useCallback(() => setOverridesVersion((v) => v + 1), []);

  const merged = useMemo(
    () => project(data, overridesRef.current),
    [
      data,
      overridesVersion, // eslint-disable-line react-hooks/exhaustive-deps
    ],
  );

  useEffect(() => {
    const bag = transportOf(api);
    if (!bag) throw new Error("useLiveQuery requires a client from createClient");
    let stopped = false;
    let loaded = false;
    const buffered: LiveQueryEvent<Row>[] = [];
    const tombstones = new Set<string>();

    setError(null);
    setLoading(true);
    setConnected(false);
    dataRef.current = null;
    setData(null);
    overridesRef.current = new Map();

    const applyEvent = (event: LiveQueryEvent<Row>): void => {
      if (!loaded || stopped) return;
      if (event.kind !== "upsert") {
        const cleared = clearOptimisticPatch(overridesRef.current, [event.id]);
        if (cleared !== overridesRef.current) {
          overridesRef.current = cleared;
          bumpOverrides();
        }
        const prev = dataRef.current;
        if (prev === null) return;
        const next = reduceLiveQueryRows(prev, idOfRef.current, event);
        if (next !== prev) {
          dataRef.current = next;
          setData(next);
        }
        return;
      }
      const prev = dataRef.current;
      if (prev === null) return;
      const pk = idOfRef.current(event.row);
      const idx = prev.findIndex((r) => idOfRef.current(r) === pk);
      const stale =
        idx >= 0 &&
        overridesRef.current.get(pk) === undefined &&
        isStaleUpsert(prev[idx]!, event.row, opts.versionOf);
      if (stale) return;
      const next = reduceLiveQueryRows(prev, idOfRef.current, event, overridesRef.current);
      if (next !== prev) {
        dataRef.current = next;
        setData(next);
      }
      // Round-trip complete — this row no longer needs its optimistic image.
      if (overridesRef.current.get(pk) !== undefined) {
        overridesRef.current = clearOptimisticPatch(overridesRef.current, [pk]);
        bumpOverrides();
      }
    };

    const streamOpts: ResourceStreamOptions = {
      autoResubscribe: true,
      ...(bag.opts?.auth ? { getToken: bag.opts.auth.getToken } : {}),
      ...(bag.opts?.headers ? { headers: bag.opts.headers } : {}),
      ...(bag.opts?.fetch ? { fetch: bag.opts.fetch } : {}),
    };

    const stopStream = subscribeLiveResource(
      bag.base,
      live,
      query,
      {
        onOpen: () => {
          if (!stopped) setConnected(true);
        },
        onError: () => {
          if (stopped) return;
          setConnected(false);
          setError({ kind: "connection", error: new Error("live connection lost") });
        },
        onEvent: (rawEvent) => {
          const event = rawEvent as LiveQueryEvent<Row>;
          if (loaded) {
            applyEvent(event);
            return;
          }
          buffered.push(event);
          if (event.kind !== "upsert") tombstones.add(event.id);
        },
      },
      streamOpts,
    );

    // Authoritative initial read — starts after the stream opens.
    void (async () => {
      try {
        const result =
          queryKey === "null"
            ? await (listFlow as unknown as () => Promise<ClientListResult<Row>>)()
            : await (listFlow as unknown as (i: I) => Promise<ClientListResult<Row>>)(query as I);
        if (stopped) return;
        if (result.error !== null) {
          setError({ kind: "initial", error: result.error });
          setLoading(false);
          return;
        }
        const fetched = ((result.data ?? []) as readonly Row[]).filter(
          (r) => !tombstones.has(idOf(r)),
        );
        loaded = true;
        let rows: readonly Row[] = [...fetched];
        for (const ev of buffered) {
          if (ev.kind === "upsert") rows = reduceLiveQueryRows(rows, idOf, ev);
        }
        buffered.length = 0;
        dataRef.current = rows;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (err) {
        if (!stopped) {
          setError({ kind: "initial", error: err });
          setLoading(false);
        }
      }
    })();

    return () => {
      stopped = true;
      stopStream();
    };
  }, [live.method, live.path, queryKey, refreshKey, bumpOverrides]);

  const mutate = useCallback(
    async <X, Y, M extends Record<string, unknown>>(
      flow: ClientCall<X, Y, M>,
      input: X,
      mopts?: {
        readonly optimistic?: (rows: readonly Row[]) => readonly Row[];
        readonly pkOf?: (input: X) => string;
        readonly pkFromResult?: (data: Y) => string | undefined;
      },
    ): Promise<ClientResult<Y, M>> => {
      const projectOptimistic = mopts?.optimistic;
      const snapshot = dataRef.current;
      let patchedIds: readonly string[] = [];
      if (snapshot !== null && projectOptimistic !== undefined) {
        const projected = projectOptimistic(snapshot);
        patchedIds = collectChangedIds(snapshot, projected, idOfRef.current);
        for (const id of patchedIds) {
          const before = snapshot.find((r) => idOfRef.current(r) === id);
          const after = projected.find((r) => idOfRef.current(r) === id);
          if (!before || !after) continue;
          overridesRef.current = applyOptimisticPatch(
            overridesRef.current,
            id,
            diffRows(before, after),
          );
        }
        if (patchedIds.length > 0) {
          dataRef.current = projected;
          setData(projected);
          bumpOverrides();
        }
      }
      let result: ClientResult<Y, M>;
      try {
        result =
          input === undefined
            ? await (flow as unknown as () => Promise<ClientResult<Y, M>>)()
            : await (flow as unknown as (i: X) => Promise<ClientResult<Y, M>>)(input);
      } catch (err) {
        rollback(patchedIds, snapshot, dataRef, setData, overridesRef, bumpOverrides);
        throw err;
      }
      if (result.error !== null) {
        rollback(patchedIds, snapshot, dataRef, setData, overridesRef, bumpOverrides);
        return result;
      }
      // Success — clear overrides where a PK round-trips so real CDC upserts
      // replace the local image without re-projecting patches.
      if (result.data !== null) {
        const clearTargets = confirmClearTargets(result.data, input, mopts);
        if (clearTargets.length > 0) {
          overridesRef.current = clearOptimisticPatch(overridesRef.current, clearTargets);
          bumpOverrides();
        }
      }
      return result;
    },
    [bumpOverrides],
  );

  return { data: merged, error, isLoading, isConnected, mutate };
}

type ClientListResult<Row> = ClientResult<Row[], Record<string, never>>;

function rollback<Row>(
  ids: readonly string[],
  snapshot: readonly Row[] | null,
  dataRef: { current: readonly Row[] | null },
  setData: (rows: readonly Row[] | null) => void,
  overridesRef: { current: ReadonlyMap<string, Partial<Row>> },
  bump: () => void,
): void {
  if (ids.length > 0 && overridesRef.current.size > 0) {
    overridesRef.current = clearOptimisticPatch(overridesRef.current, ids);
  }
  if (snapshot !== null && dataRef.current !== snapshot) {
    dataRef.current = snapshot;
    setData(snapshot);
  }
  bump();
}

function confirmClearTargets<X, Y>(
  resultData: Y,
  input: X,
  mopts:
    | {
        readonly pkOf?: (input: X) => string;
        readonly pkFromResult?: (data: Y) => string | undefined;
      }
    | undefined,
): string[] {
  const targets: string[] = [];
  const fromResult = mopts?.pkFromResult?.(resultData);
  if (fromResult !== undefined) targets.push(fromResult);
  const fromInput = safePk(mopts?.pkOf, input);
  if (fromInput !== undefined && !targets.includes(fromInput)) targets.push(fromInput);
  return targets;
}

function safePk(f: ((input: never) => string) | undefined, input: unknown): string | undefined {
  if (f === undefined) return undefined;
  try {
    const v = f(input as never);
    return v === "" ? undefined : v;
  } catch {
    return undefined;
  }
}

function project<Row>(
  rows: readonly Row[] | null,
  overrides: ReadonlyMap<string, Partial<Row>>,
): readonly Row[] | null {
  if (rows === null || overrides.size === 0) return rows;
  return rows.map((r) => {
    const patch = overrides.get(String((r as Record<string, unknown>).id));
    return patch !== undefined ? ({ ...r, ...patch } as Row) : r;
  });
}

function collectChangedIds<Row>(
  before: readonly Row[],
  after: readonly Row[],
  idOf: (row: Row) => string,
): string[] {
  const beforeById = new Map(before.map((r) => [idOf(r), r]));
  const ids: string[] = [];
  for (const r of after) {
    const id = idOf(r);
    const prev = beforeById.get(id);
    if (prev === undefined || JSON.stringify(prev) !== JSON.stringify(r)) ids.push(id);
  }
  return ids;
}

function diffRows<Row>(before: Row, after: Row): Partial<Row> {
  const out: Record<string, unknown> = {};
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const k of Object.keys(a)) {
    if (!Object.is(b[k], a[k])) out[k] = a[k];
  }
  return out as Partial<Row>;
}
