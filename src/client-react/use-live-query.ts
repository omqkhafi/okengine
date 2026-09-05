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
import { MUTATION_ID_HEADER } from "../kernel/realtime-bind.ts";
import {
  applyOptimisticPatch,
  clearOptimisticPatch,
  isReplayedEvent,
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
  /**
   * Subscribe this hook to auth identity changes: when the client's
   * `auth.refresh()` succeeds, reconnect via the full subscribe protocol
   * (new snapshot + replay) so RLS-scoped rows reflect the new identity.
   */
  readonly onAuthRefresh?: (cb: () => void) => () => void;
  /**
   * When `false`, no SSE connection and no list fetch — the hook stays idle
   * (`data` remains `null`). Re-subscribes when it flips back to `true`.
   * Default `true`.
   */
  readonly enabled?: boolean;
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
   * A reconnect attempt is in flight (stream dropped, backoff or re-open
   * pending). Distinct from {@link isLoading} — data stays rendered while
   * reconnecting; it is only `true` after the first successful load.
   */
  readonly isReconnecting: boolean;
  /**
   * Manual HTTP list refresh. Does not replace the subscribe protocol —
   * reconnects always re-run the full snapshot + replay cycle.
   */
  refetch: () => Promise<void>;
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
 * @param args.live - SSE route from `$routes` (optional when `listPath` given)
 * @param args.listPath - List REST path; live defaults to `` `${listPath}/live` ``
 * @param args.options - PK/version extractors, refresh key, `enabled`
 */
export function useLiveQuery<Row extends Record<string, unknown>, I = void>(args: {
  readonly api: object;
  readonly listFlow: ClientCall<I, Row[], Record<string, never>>;
  readonly query?: I;
  readonly live?: LiveRouteContract;
  /** List HTTP path — when `live` is omitted, SSE uses `GET ${listPath}/live`. */
  readonly listPath?: string;
  readonly options?: UseLiveQueryOptions<Row>;
}): UseLiveQueryState<Row> {
  const { api, listFlow, query, options } = args;
  const live: LiveRouteContract = args.live ?? {
    method: "GET",
    path: `${(args.listPath ?? "").replace(/\/$/, "")}/live`,
  };
  if (!args.live && !args.listPath) {
    throw new Error("useLiveQuery requires `live` or `listPath` to derive the SSE route");
  }
  const opts = options ?? {};
  const enabled = opts.enabled ?? true;
  const defaultIdOf = useCallback((row: Row) => String((row as Record<string, unknown>).id), []);
  const idOf = opts.idOf ?? defaultIdOf;

  const queryKey = JSON.stringify(query ?? null);
  const refreshKey = opts.refreshKey;

  const [data, setData] = useState<readonly Row[] | null>(null);
  const [error, setError] = useState<LiveQueryError | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isConnected, setConnected] = useState(false);
  const [isReconnecting, setReconnecting] = useState(false);

  // Refs mirror state so streaming/mutate callbacks read latest without
  // resubscribing.
  const dataRef = useRef<readonly Row[] | null>(null);
  dataRef.current = data;
  const idOfRef = useRef(idOf);
  idOfRef.current = idOf;
  const overridesRef = useRef<ReadonlyMap<string, Partial<Row>>>(new Map());
  const [overridesVersion, setOverridesVersion] = useState(0);
  const bumpOverrides = useCallback(() => setOverridesVersion((v) => v + 1), []);
  // Highest applied event seq (0 = none) — reconnect replays skip at/below.
  const lastSeqRef = useRef(0);
  // mutationId → settle status for in-flight/just-settled mutations. Upserts
  // echoing a pending-or-failed id are the client's own late CDC echoes.
  const pendingMutationsRef = useRef<Map<string, "ok" | "error">>(new Map());

  // Identity refresh (Realtime plan): when the client's `auth.refresh()`
  // succeeds, re-run the full subscribe protocol (new snapshot + replay) so
  // RLS-scoped rows reflect the new identity. `onAuthRefresh` registers a
  // listener; each fire bumps `refreshBump`, re-triggering the main effect.
  const [authVersion, setAuthVersion] = useState(0);
  const [refreshBump, setRefreshBump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return opts.onAuthRefresh?.(() => setAuthVersion((v) => v + 1));
  }, [enabled, opts.onAuthRefresh]);
  useEffect(() => {
    if (authVersion > 0) setRefreshBump((v) => v + 1);
  }, [authVersion]);

  const merged = useMemo(
    () => project(data, overridesRef.current),
    [
      data,
      overridesVersion, // eslint-disable-line react-hooks/exhaustive-deps
    ],
  );

  useEffect(() => {
    if (!enabled) {
      // Idle: no SSE, no list fetch; state resets for a clean re-subscribe.
      setError(null);
      setLoading(true);
      setConnected(false);
      setReconnecting(false);
      dataRef.current = null;
      setData(null);
      overridesRef.current = new Map();
      lastSeqRef.current = 0;
      return;
    }
    const bag = transportOf(api);
    if (!bag) throw new Error("useLiveQuery requires a client from createClient");
    let stopped = false;
    let loaded = false;
    const buffered: LiveQueryEvent<Row>[] = [];
    const tombstones = new Set<string>();

    setError(null);
    setLoading(true);
    setConnected(false);
    setReconnecting(false);
    dataRef.current = null;
    setData(null);
    overridesRef.current = new Map();
    lastSeqRef.current = 0;

    const applyEvent = (event: LiveQueryEvent<Row>): void => {
      if (!loaded || stopped) return;
      if (isReplayedEvent(lastSeqRef.current, event)) return;
      if (event.seq !== undefined && event.seq > lastSeqRef.current) {
        lastSeqRef.current = event.seq;
      }
      if (event.kind === "upsert" && event.mutationId !== undefined) {
        // Optimistic race rule (Realtime plan): an upsert echoing this
        // client's own mutationId is skipped until the response settles —
        // and dropped entirely when the write rolled back or failed.
        const status = pendingMutationsRef.current.get(event.mutationId);
        if (status === "ok" || status === "error") return;
      }
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
          if (stopped) return;
          setConnected(true);
          setReconnecting(false);
        },
        onError: () => {
          if (stopped) return;
          setConnected(false);
          if (loaded) setReconnecting(true);
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
    const loadOnce = async (): Promise<void> => {
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
    };
    void loadOnce();
    refetchRef.current = loadOnce;

    return () => {
      stopped = true;
      stopStream();
      refetchRef.current = undefined;
    };
  }, [enabled, live.method, live.path, queryKey, refreshKey, refreshBump, bumpOverrides]);

  // Manual refetch — stable identity; calls the latest list loader. Does not
  // replace the subscribe protocol; reconnects re-run the full cycle.
  const refetchRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const refetch = useCallback(async (): Promise<void> => {
    await refetchRef.current?.();
  }, []);

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
      // Required mutationId (Realtime correctness contract): a client UUID
      // rides onto this call so CDC upserts echo it back and rolled-back
      // writes can drop their own late events.
      const mutationId = newMutationId();
      const bag = transportOf(api);
      let result: ClientResult<Y, M>;
      try {
        const send = (): Promise<ClientResult<Y, M>> =>
          input === undefined
            ? (flow as unknown as () => Promise<ClientResult<Y, M>>)()
            : (flow as unknown as (i: X) => Promise<ClientResult<Y, M>>)(input);
        result =
          bag !== undefined
            ? await bag.perCallHeaders.run({ [MUTATION_ID_HEADER]: mutationId }, send)
            : await send();
      } catch (err) {
        pendingMutationsRef.current.set(mutationId, "error");
        rollback(patchedIds, snapshot, dataRef, setData, overridesRef, bumpOverrides);
        throw err;
      }
      if (result.error !== null) {
        pendingMutationsRef.current.set(mutationId, "error");
        rollback(patchedIds, snapshot, dataRef, setData, overridesRef, bumpOverrides);
        return result;
      }
      // Success — events echoing this mutationId are reconciles, not foreign
      // writes; drop them for a grace window instead of double-applying.
      pendingMutationsRef.current.set(mutationId, "ok");
      setTimeout(() => {
        pendingMutationsRef.current.delete(mutationId);
      }, PENDING_MUTATION_TTL_MS);
      // Clear overrides where a PK round-trips so real CDC upserts replace
      // the local image without re-projecting patches.
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

  return { data: merged, error, isLoading, isConnected, isReconnecting, refetch, mutate };
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

/** Grace window a settled mutationId stays in the dedupe set (ms). */
const PENDING_MUTATION_TTL_MS = 10_000;

/**
 * Client-generated UUID for the `X-Oke-Mutation-Id` header. Prefers
 * `crypto.randomUUID`; falls back to a timestamp+counter composite where
 * `crypto` is unavailable (old test environments).
 */
function newMutationId(): string {
  if (globalThis.crypto?.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID();
  }
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2)}-${mutationCounter++}`;
}
let mutationCounter = 0;
