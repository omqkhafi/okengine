/**
 * `postgres` instance registry — one row per process, TTL liveness.
 *
 * Own-row UPSERT (not SKIP LOCKED). Alive ⇔ `lease_expires_at > now`.
 * No sweeper — readers filter expired rows.
 */

import type { ConfigEnv } from "../config/index.ts";
import type { InstanceRow, InstanceStore } from "../kernel/instances.ts";
import { resolvePostgresUrl, sharedPostgresClient, toPostgresParams } from "./postgres.ts";

/** Minimal SQL surface for the postgres instance store. */
export interface PostgresInstanceSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  close(): Promise<void>;
}

/** Options for {@link createPostgresInstanceStore}. */
export interface CreatePostgresInstanceStoreOptions {
  /** Postgres connection URL (Bun.SQL). Ignored when `sql` is injected. */
  readonly url?: string;
  /** Injected SQL surface (tests / fakes). */
  readonly sql?: PostgresInstanceSql;
  /** Injected Bun.SQL-compatible client. */
  readonly client?: BunInstanceClient;
}

/** Minimal Bun.SQL surface used by the real driver. */
export interface BunInstanceClient {
  unsafe(
    sql: string,
    values?: unknown[],
  ): PromiseLike<Record<string, unknown>[] | { length: number; changes?: number }>;
  close?(options?: { timeout?: number }): Promise<void>;
}

const UPSERT_SQL = `INSERT INTO oke_instances (id, started_at, heartbeat_at, lease_expires_at, env, pid) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET heartbeat_at = EXCLUDED.heartbeat_at, lease_expires_at = EXCLUDED.lease_expires_at, env = EXCLUDED.env, pid = EXCLUDED.pid`;

function wrapBunClient(client: BunInstanceClient): PostgresInstanceSql {
  return {
    async query(sql, params = []) {
      const pg = toPostgresParams(sql);
      const result = await client.unsafe(pg, [...params]);
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return Array.from(result as ArrayLike<Record<string, unknown>>);
    },
    async exec(sql, params = []) {
      const pg = toPostgresParams(sql);
      const result = await client.unsafe(pg, [...params]);
      if (
        result &&
        typeof result === "object" &&
        "changes" in result &&
        typeof (result as { changes: unknown }).changes === "number"
      ) {
        return { changes: (result as { changes: number }).changes };
      }
      if (Array.isArray(result)) return { changes: result.length };
      return { changes: 0 };
    },
    async close() {
      await client.close?.();
    },
  };
}

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function rowFromDb(row: Record<string, unknown>): InstanceRow {
  const pid = numOrUndef(row.pid);
  return {
    id: String(row.id),
    startedAt: Number(row.started_at),
    heartbeatAt: Number(row.heartbeat_at),
    leaseExpiresAt: Number(row.lease_expires_at),
    env: String(row.env) as ConfigEnv,
    ...(pid !== undefined ? { pid } : {}),
  };
}

async function ensureSchema(sql: PostgresInstanceSql): Promise<void> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_instances (
    id TEXT PRIMARY KEY,
    started_at BIGINT NOT NULL,
    heartbeat_at BIGINT NOT NULL,
    lease_expires_at BIGINT NOT NULL,
    env TEXT NOT NULL,
    pid INTEGER
  )`);
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_instances_lease ON oke_instances (lease_expires_at)`,
  );
}

/**
 * Open a postgres-backed instance store (shared fleet census).
 *
 * @param options - URL / injected sql / Bun.SQL client
 */
export async function createPostgresInstanceStore(
  options: CreatePostgresInstanceStoreOptions = {},
): Promise<InstanceStore & { readonly sql: PostgresInstanceSql }> {
  const sql =
    options.sql ??
    wrapBunClient(
      options.client ??
        (sharedPostgresClient(resolvePostgresUrl(options.url)) as unknown as BunInstanceClient),
    );

  await ensureSchema(sql);

  const store: InstanceStore & { readonly sql: PostgresInstanceSql } = {
    kind: "postgres",
    sql,
    async upsert(row) {
      await sql.exec(UPSERT_SQL, [
        row.id,
        row.startedAt,
        row.heartbeatAt,
        row.leaseExpiresAt,
        row.env,
        row.pid ?? null,
      ]);
    },
    async get(id) {
      const rows = await sql.query(`SELECT * FROM oke_instances WHERE id = ?`, [id]);
      if (!rows[0]) return undefined;
      return rowFromDb(rows[0]);
    },
    async list() {
      const rows = await sql.query(`SELECT * FROM oke_instances`);
      return rows.map(rowFromDb);
    },
    async listAlive(now) {
      const rows = await sql.query(`SELECT * FROM oke_instances WHERE lease_expires_at > ?`, [now]);
      return rows.map(rowFromDb);
    },
    async remove(id) {
      await sql.exec(`DELETE FROM oke_instances WHERE id = ?`, [id]);
    },
    async close() {
      await sql.close();
    },
  };

  return store;
}
