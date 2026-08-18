/**
 * SQL-backed durable KV — `oke_kv` JSONB on the shared store.sql connection.
 *
 * Not a catalog `drivers.store.kv` id. Cache namespaces stay redis/memory.
 */

import type { KvNamespace, SqlConnection } from "../../drivers/types.ts";
import { parseTtlMs } from "./cache.ts";

/** Engine-owned durable KV table — boot DDL, excluded from `oke db push`. */
export const OKE_KV_TABLE = "oke_kv";

/** Options for {@link openSqlKvNamespace}. */
export interface OpenSqlKvOptions {
  /** Shared SQL connection (`sharedSqlConn`). */
  readonly conn: SqlConnection;
  /** `store.kv` namespace name. */
  readonly namespace: string;
  /** Injectable clock (epoch ms). */
  readonly now: () => number;
}

/** SQL KV handle — {@link KvNamespace} plus {@link SqlKvNamespace.purgeExpired}. */
export interface SqlKvNamespace extends KvNamespace {
  readonly driverId: "postgres" | "pglite" | "memory";
  /**
   * Delete rows whose `expires_at` has passed.
   *
   * @returns Rows removed
   */
  purgeExpired(): Promise<number>;
}

const ensured = new WeakSet<SqlConnection>();

/**
 * Create `oke_kv` + the expires partial index (idempotent).
 *
 * @param conn - Shared SQL connection
 */
export async function ensureOkeKvSchema(conn: SqlConnection): Promise<void> {
  if (ensured.has(conn)) return;
  await conn.exec(`CREATE TABLE IF NOT EXISTS ${OKE_KV_TABLE} (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    expires_at BIGINT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (namespace, key)
  )`);
  await conn.exec(
    `CREATE INDEX IF NOT EXISTS oke_kv_expires ON ${OKE_KV_TABLE} (expires_at) WHERE expires_at IS NOT NULL`,
  );
  ensured.add(conn);
}

/**
 * Open a durable KV namespace on an already-open SQL connection.
 *
 * @param options - Connection / namespace / clock
 */
export async function openSqlKvNamespace(options: OpenSqlKvOptions): Promise<SqlKvNamespace> {
  const { conn, namespace, now } = options;
  await ensureOkeKvSchema(conn);
  await purgeExpiredOn(conn, now());

  return {
    driverId: conn.driverId,
    async get(key) {
      const rows = await conn.query(
        `SELECT value FROM ${OKE_KV_TABLE}
         WHERE namespace = ? AND key = ?
           AND (expires_at IS NULL OR expires_at > ?)`,
        [namespace, key, now()],
      );
      const raw = rows[0]?.value;
      if (raw === undefined) return undefined;
      return decodeJsonb(raw);
    },
    async set(key, value, ttl) {
      await purgeExpiredOn(conn, now());
      const t = now();
      const expiresAt = ttlExpiresAt(ttl, t);
      await conn.exec(
        `INSERT INTO ${OKE_KV_TABLE} (namespace, key, value, expires_at, updated_at)
         VALUES (?, ?, CAST(? AS JSONB), ?, ?)
         ON CONFLICT (namespace, key) DO UPDATE SET
           value = EXCLUDED.value,
           expires_at = EXCLUDED.expires_at,
           updated_at = EXCLUDED.updated_at`,
        [namespace, key, JSON.stringify(value), expiresAt, t],
      );
    },
    async delete(key) {
      const result = await conn.exec(
        `DELETE FROM ${OKE_KV_TABLE} WHERE namespace = ? AND key = ?`,
        [namespace, key],
      );
      return result.changes > 0;
    },
    async list(prefix = "") {
      const rows = await conn.query(
        `SELECT key FROM ${OKE_KV_TABLE}
         WHERE namespace = ?
           AND (expires_at IS NULL OR expires_at > ?)
           AND key LIKE ?
         ORDER BY key`,
        [namespace, now(), `${prefix}%`],
      );
      return rows.map((row) => String(row.key ?? ""));
    },
    async ttlMs(key) {
      const rows = await conn.query(
        `SELECT expires_at FROM ${OKE_KV_TABLE}
         WHERE namespace = ? AND key = ?
           AND (expires_at IS NULL OR expires_at > ?)`,
        [namespace, key, now()],
      );
      const raw = rows[0]?.expires_at;
      if (raw === undefined || raw === null) return null;
      const at = Number(raw);
      if (!Number.isFinite(at)) return null;
      return Math.max(0, at - now());
    },
    async eval() {
      throw new Error("oke store: durable store.kv does not support eval");
    },
    async close() {
      /* Shared connection — StoreRuntime.close owns it. */
    },
    async purgeExpired() {
      return purgeExpiredOn(conn, now());
    },
  };
}

/**
 * Decode a JSONB cell — PGlite/Postgres may return an object or a string.
 *
 * @param raw - Driver cell
 */
function decodeJsonb(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Absolute expiry from a TTL string, or `null` when omitted / unparsed.
 *
 * @param ttl - Duration like `"7d"`
 * @param t - Now (epoch ms)
 */
function ttlExpiresAt(ttl: string | undefined, t: number): number | null {
  if (ttl === undefined) return null;
  const ms = parseTtlMs(ttl);
  if (ms <= 0) return null;
  return t + ms;
}

/**
 * Delete expired rows across every namespace on this connection.
 *
 * @param conn - Shared SQL connection
 * @param t - Now (epoch ms)
 */
async function purgeExpiredOn(conn: SqlConnection, t: number): Promise<number> {
  const result = await conn.exec(
    `DELETE FROM ${OKE_KV_TABLE} WHERE expires_at IS NOT NULL AND expires_at <= ?`,
    [t],
  );
  return result.changes;
}
