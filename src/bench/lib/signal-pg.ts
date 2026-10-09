/**
 * Live-Postgres SQL surface for `openPostgresSignal` (`src/drivers/signal-postgres.ts`).
 *
 * Bun.SQL has no LISTEN/NOTIFY API (see `src/drivers/bun-native-completeness.test.ts`),
 * so this adapter:
 *   - runs the real transactional outbox (INSERT + FOR UPDATE SKIP LOCKED claims)
 *     against live Postgres via `Bun.SQL`;
 *   - fans `notify()` out to in-process `listen()` callbacks so wakeups work
 *     within one process, and additionally issues a best-effort real
 *     `pg_notify` for cross-process visibility.
 *
 * Cross-process LISTEN delivery is NOT covered — bench artifacts using this
 * adapter must say so.
 */

import { affectedRows } from "../../drivers/affected-rows.ts";
import {
  toPostgresParams,
  withPinnedPostgres,
  type PostgresQueryResult,
} from "../../drivers/postgres.ts";
import type { PostgresSignalSql } from "../../drivers/signal-postgres.ts";

interface UnsafeClient {
  unsafe(sql: string, values?: readonly unknown[]): PromiseLike<PostgresQueryResult>;
}

/**
 * Bun.SQL adapter for the postgres signal bus. Tests inject a client
 * whose `unsafe` returns the real driver shape.
 *
 * @param client - Bun.SQL-compatible client
 * @param listeners - In-process NOTIFY fanout
 */
export function signalPgFromClient(
  client: UnsafeClient,
  listeners: Map<string, Set<(payload: string) => void>> = new Map(),
): PostgresSignalSql {
  return wrap(client, listeners);
}

function wrap(
  client: UnsafeClient,
  listeners: Map<string, Set<(payload: string) => void>>,
): PostgresSignalSql {
  return {
    async query(sql, params = []) {
      const result = await client.unsafe(toPostgresParams(sql, params), [...params]);
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return Array.from(result as ArrayLike<Record<string, unknown>>);
    },
    async exec(sql, params = []) {
      const result = await client.unsafe(toPostgresParams(sql, params), [...params]);
      return { changes: affectedRows(result) };
    },
    // withPinnedPostgres pins ONE pooled connection — required behind pgdog.
    begin: (fn) =>
      withPinnedPostgres(client as never, (tx) => fn(wrap(tx as UnsafeClient, listeners))),
    async listen(channel, onNotify) {
      const set = listeners.get(channel) ?? new Set<(payload: string) => void>();
      set.add(onNotify);
      listeners.set(channel, set);
      return () => {
        set.delete(onNotify);
      };
    },
    async notify(channel, payload) {
      // Real NOTIFY keeps cross-process semantics on the server; local fanout
      // is what actually wakes this process's drain loop (no LISTEN API).
      try {
        await client.unsafe("SELECT pg_notify($1, $2)", [channel, payload]);
      } catch {
        /* best-effort */
      }
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
    async close() {
      /* per-transaction wrappers share the parent pool — nothing to close */
    },
  };
}

export function createBunSignalSql(url: string): PostgresSignalSql & { close(): Promise<void> } {
  const client = new Bun.SQL(url, { max: 4 }) as unknown as UnsafeClient & {
    close?: (options?: { timeout?: number }) => Promise<void>;
  };
  const listeners = new Map<string, Set<(payload: string) => void>>();
  const api = wrap(client, listeners);
  return {
    ...api,
    close: async () => {
      await client.close?.();
    },
  };
}
