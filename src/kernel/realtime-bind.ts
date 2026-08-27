/**
 * Boot-time Realtime wire-up (Phase 2 of the realtime round).
 *
 * When the booted Store exposes a primary SQL connection on a
 * `row_passes_policies`-capable driver (`postgres` / `pglite`):
 *  1. Install the process-wide `sql-session` CDC sink → LiveQuery runtime
 *     ingest, outbox append (multi-host durability), and user-declared CDC
 *     flow dispatch.
 *  2. Start a {@link CdcOutboxRunner} SKIP LOCKED poller draining durable
 *     events back into the same runtime.
 *  3. Register each subscribed table's live signal on the Signal bus so
 *     existing `fx.live` SSE routes deliver classified events to clients.
 *
 * Torn down by {@link unbindRealtimeBridge} on app stop.
 */

import { CdcOutbox, CdcOutboxRunner, type OutboxRow } from "../drivers/cdc-outbox.ts";
import { RLS_CONTEXT_DRIVERS, type RlsIdentity } from "../drivers/pg-rls.ts";
import type { SqlConnection } from "../drivers/types.ts";
import { liveQueryRuntimeFromConn } from "../elements/store/live-query-server.ts";
import { setSqlCdcSink, type SqlCdcSink } from "../elements/store/sql-session.ts";
import type { LiveQueryEvent, LiveSubscription } from "../elements/store/live-query-runtime.ts";
import { currentAbortSignal, linkAbort } from "./abort-scope.ts";

/**
 * Column-kind hint for one SQL column — drives {@link restoreImage} type
 * restoration for outbox-round-tripped CDC images.
 */
export type LiveColumnKind = "string" | "number" | "boolean";

/** Internal Signal name prefix carrying classified live-query events. */
const LIVE_SIGNAL_PREFIX = "oke/live/sql:";

/**
 * Reserved live-signal name for one table. Exported for compiler synthesis —
 * manifest effects reference the exact same string.
 *
 * @param table - Physical table name
 */
export function liveSignalName(table: string): string {
  return `${LIVE_SIGNAL_PREFIX}${table}`;
}

/** Mutation header echoed into `mutationId` on write-path events. */
export const MUTATION_ID_HEADER = "x-oke-mutation-id";

/** Per-stream event buffer cap (bounded memory per SSE session). */
const LIVE_STREAM_BUFFER_MAX = 512;

/** Active bridge state (singleton per process). */
let active: {
  readonly runtime: ReturnType<typeof liveQueryRuntimeFromConn>;
  readonly runner?: CdcOutboxRunner;
} | null = null;

/** Delivery subscription for one SSE client (returned to `fx.live` glue). */
export interface LiveSubscriptionHandle {
  /** Push one classified event to this subscriber's stream. */
  deliver(event: LiveQueryEvent): void;
  /** Detach from fan-out (idempotent). */
  unsubscribe(): void;
}

/**
 * Wire the realtime stack for this process. Idempotent — repeated boots in
 * one process reuse the first bridge (test graphs re-`oke()` freely).
 *
 * @param primary - Shared primary SQL connection (postgres/pglite only)
 * @param dispatchCdc - App-level dispatcher for user-declared CDC flows
 * @returns The process runtime, or `null` when the SQL driver cannot host it
 */
export function bindRealtimeBridge(
  primary: SqlConnection,
  dispatchCdc: (
    tableName: string,
    payload: { readonly before: unknown; readonly after: unknown },
    column?: string,
  ) => Promise<unknown[]> | unknown[],
): ReturnType<typeof liveQueryRuntimeFromConn> | null {
  if (!RLS_CONTEXT_DRIVERS.has(primary.driverId)) return null;
  if (active) return active.runtime;

  const runtime = liveQueryRuntimeFromConn(primary);
  const outbox = new CdcOutbox(primary);
  // First tick creates the table + indexes without blocking boot.
  void outbox.ensure().catch(() => undefined);

  const sink: SqlCdcSink = (event) => {
    // In-process leg first — classification needs no outbox round-trip.
    runtime.onCdc(event);
    // Durable multi-host leg: other hosts drain via the poller. Local events
    // are also appended so a restarted process replays un-delivered rows;
    // the poller redelivery is idempotent at the client by PK+seq.
    void outbox.append(event).catch(() => undefined);
    void dispatchCdc(event.tableName, { before: event.before, after: event.after });
  };
  setSqlCdcSink(sink);

  const runner = new CdcOutboxRunner(
    outbox,
    async (rows: readonly OutboxRow[]) => {
      for (const row of rows) {
        runtime.onCdc({
          tableName: row.tableName,
          op: row.op,
          before: row.before,
          after: row.after,
          ...(Number.isFinite(row.seq) ? { seq: row.seq } : {}),
        });
      }
    },
    {},
  );
  runner.start();

  active = { runtime, runner };
  return runtime;
}

/**
 * Push→pull bridge: convert runtime `deliver` callbacks into an SSE async
 * iterable. Bounded per-stream buffer — a slow client sheds its own events
 * (silently stale until resync; the v1 documented trade-off) instead of
 * pinning the fan-out worker pool.
 */
export interface LiveEventStream {
  /** Classified events as SSE frames (already JSON-shaped). */
  readonly chunks: AsyncIterable<{ readonly data: LiveQueryEvent }>;
  /** Stop fan-out and close the iterator (idempotent). */
  close(): Promise<void>;
}

/** Options for {@link openLiveStream} — one SSE subscriber's window. */
export interface OpenLiveStreamOptions {
  /** Physical table name. */
  readonly table: string;
  /** Subscriber stamp (gate/user/scopes/tenant). */
  readonly identity: RlsIdentity;
  /** Primary key column. */
  readonly pkColumn: string;
  /** List query window compiled to SQL (`?` placeholders), when any. */
  readonly whereSql?: string;
  readonly whereParams?: readonly unknown[];
  /**
   * Column-kind hints for JSONB image restoration on outbox replay
   * (`jsKey → primitive kind`). Optional.
   */
  readonly tableColumns?: Readonly<Record<string, LiveColumnKind>>;
}
/**
 * Subscribe this SSE session to classified live events for one table.
 *
 * The returned handle implements the {@link Fx} live-stream physics without
 * touching a signal tape: per-subscriber classification makes shared-tape
 * delivery impossible to do safely — each identity's verdict differs.
 *
 * Links the ambient structured-concurrency abort signal: when the request
 * branch aborts (client disconnect), the subscription detaches itself —
 * the same ALS physics `fx.live` SSE streams use.
 *
 * @param id - Stable stream id (used for registry dedupe + metrics)
 * @param options - Table, stamp, query window, column hints
 */
export function openLiveStream(
  id: string,
  options: OpenLiveStreamOptions,
  runtimeOverride?: ReturnType<typeof liveQueryRuntimeFromConn>,
): LiveEventStream {
  const runtime = runtimeOverride ?? active?.runtime;
  if (!runtime) throw new Error("live subscribe before realtime bridge bind");
  const buffer: { readonly data: LiveQueryEvent }[] = [];
  let woke = false;
  let done = false;
  let notify: (() => void) | undefined;
  const wake = (): void => {
    if (!woke || done) return;
    woke = false;
    const n = notify;
    notify = undefined;
    n?.();
  };
  const sub: LiveSubscription = {
    ...options,
    id,
    ref: `sql:${options.table}`,
    deliver(event) {
      if (done) return;
      // Per-stream cap: bounded memory per subscriber regardless of churn.
      if (buffer.length >= LIVE_STREAM_BUFFER_MAX) {
        // Shed from the front — the oldest missed event is re-fetchable via
        // list refetch; newer state wins for eventual convergence.
        buffer.shift();
      }
      buffer.push({ data: event });
      wake();
    },
  };
  const unsubscribe = runtime.subscribe(sub);
  const chunks: AsyncIterable<{ readonly data: LiveQueryEvent }> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<{ readonly data: LiveQueryEvent }>> {
          for (;;) {
            const frame = buffer.shift();
            if (frame !== undefined) return { done: false as const, value: frame };
            if (done) return { done: true as const, value: undefined };
            await new Promise<void>((resolve) => {
              notify = resolve;
              woke = true;
            });
          }
        },
        async return(): Promise<IteratorResult<{ readonly data: LiveQueryEvent }>> {
          await close();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  // Ambient-branch abort (client disconnect) detaches the subscription —
  // same ALS physics `createLiveStream` uses for `fx.live` SSE.
  const local = new AbortController();
  const unlink = linkAbort(currentAbortSignal(), local);
  const onAbort = (): void => {
    void close();
  };
  local.signal.addEventListener("abort", onAbort, { once: true });

  async function close(): Promise<void> {
    if (done) return;
    done = true;
    unsubscribe();
    local.signal.removeEventListener("abort", onAbort);
    unlink();
    wake();
  }

  return { chunks, close };
}

/**
 * Register an SSE-side subscription without opening a stream. Kept for
 * transport tests that drive `deliver` manually.
 *
 * @param table - Physical table name
 * @param id - Stable stream/session id
 * @param identity - Subscriber stamp
 * @param sub - Query window + delivery sink
 */
export function subscribeLive(
  table: string,
  id: string,
  identity: RlsIdentity,
  sub: {
    readonly pkColumn: string;
    readonly whereSql?: string;
    readonly whereParams?: readonly unknown[];
    deliver(event: LiveQueryEvent): void;
  },
): LiveSubscriptionHandle {
  if (!active) throw new Error("live subscribe before realtime bridge bind");
  const unsub = active.runtime.subscribe({ ...sub, id, ref: `sql:${table}`, table, identity });
  return { deliver: sub.deliver, unsubscribe: unsub };
}

/** Tear down polling and the process-wide sink (app stop). */
export function unbindRealtimeBridge(): void {
  if (!active) return;
  active.runner?.stop();
  setSqlCdcSink(null);
  active = null;
}

/** Test/doctor visibility into the bound bridge. */
export function realtimeBridgeRuntime(): ReturnType<typeof liveQueryRuntimeFromConn> | undefined {
  return active?.runtime;
}
