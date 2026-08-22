/**
 * SQL persist / hydrate for {@link ApiKeyRow} on `oke_api_keys`.
 *
 * Host path: public schema on the app `store.sql()` connection
 * (`sharedSqlConn` / `DATABASE_URL`). Console attaches that same
 * {@link ApiKeyStore} — it does not own a second key table.
 */

import type { SqlConnection } from "../drivers/types.ts";
import type { ApiKeyRow } from "./tables.ts";
import { AUTH_TABLES } from "./tables.ts";
import type { ApiKeyStore } from "./api-keys.ts";

/** Minimal SQL executor for the auth key table. */
export interface ApiKeySqlExec {
  execute(sql: string, params: readonly unknown[]): Promise<void>;
  all(sql: string): Promise<readonly Record<string, unknown>[]>;
}

/**
 * Persist one key row to `oke_api_keys`.
 *
 * @param sql - Executor
 * @param row - Key row
 * @param table - Physical table (`oke_api_keys` or schema-qualified)
 */
export async function persistApiKeyRow(
  sql: ApiKeySqlExec,
  row: ApiKeyRow,
  table: string = AUTH_TABLES.apiKeys,
): Promise<void> {
  await sql.execute(
    `INSERT INTO ${table} (
      id, plane, hash, name, scopes, expires_at, rate_limit, ip_allowlist,
      creator_id, creator_scopes, created_at, last_used_at, revoked_at, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      hash = excluded.hash,
      name = excluded.name,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      rate_limit = excluded.rate_limit,
      ip_allowlist = excluded.ip_allowlist,
      creator_id = excluded.creator_id,
      creator_scopes = excluded.creator_scopes,
      last_used_at = excluded.last_used_at,
      revoked_at = excluded.revoked_at,
      tenant_id = excluded.tenant_id`,
    [
      row.id,
      row.plane,
      row.hash,
      row.name,
      JSON.stringify(row.scopes),
      row.expiresAt,
      row.rateLimit ? JSON.stringify(row.rateLimit) : null,
      JSON.stringify(row.ipAllowlist),
      row.creatorId,
      JSON.stringify(row.creatorScopes),
      row.createdAt,
      row.lastUsedAt,
      row.revokedAt,
      row.tenantId ?? null,
    ],
  );
}

/**
 * Load every key row from `oke_api_keys` into a store.
 *
 * @param sql - Executor
 * @param store - Destination store
 * @param table - Physical table
 */
export async function hydrateApiKeyStore(
  sql: ApiKeySqlExec,
  store: ApiKeyStore,
  table: string = AUTH_TABLES.apiKeys,
): Promise<void> {
  const rows = await sql.all(`SELECT * FROM ${table}`);
  for (const raw of rows) {
    const row = rowFromSql(raw);
    if (row) store.keys.set(row.id, row);
  }
}

/**
 * Bind write-through persist on a store.
 *
 * @param store - Key store
 * @param sql - Executor
 * @param table - Physical table
 */
export function bindApiKeySqlPersist(
  store: ApiKeyStore,
  sql: ApiKeySqlExec,
  table: string = AUTH_TABLES.apiKeys,
): void {
  store.persist = (row) => persistApiKeyRow(sql, row, table);
}

/** Runtime that can open the app's shared primary SQL connection. */
export interface HostApiKeySqlRuntime {
  primarySql(): Promise<SqlConnection | undefined>;
}

/**
 * Adapt a driver connection to {@link ApiKeySqlExec}.
 *
 * @param conn - Shared `store.sql()` connection
 */
export function apiKeySqlExec(conn: SqlConnection): ApiKeySqlExec {
  return {
    execute: async (sql, params) => {
      await conn.exec(sql, params);
    },
    all: async (sql) => conn.query(sql),
  };
}

/**
 * Create public `oke_api_keys` when missing (host schema, not `oke_console`).
 *
 * @param conn - Shared SQL connection
 * @param table - Physical table
 */
export async function ensureApiKeyTable(
  conn: SqlConnection,
  table: string = AUTH_TABLES.apiKeys,
): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY NOT NULL,
      plane TEXT NOT NULL,
      hash TEXT NOT NULL,
      name TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      expires_at BIGINT,
      rate_limit TEXT,
      ip_allowlist TEXT NOT NULL DEFAULT '[]',
      creator_id TEXT NOT NULL,
      creator_scopes TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      last_used_at BIGINT,
      revoked_at BIGINT,
      tenant_id TEXT
    )
  `);
  await conn.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id TEXT`);
}

/**
 * Hydrate and write-through-persist a host {@link ApiKeyStore} on `conn`.
 *
 * Leaves an already-bound `persist` hook in place (injected test stores).
 *
 * @param conn - App SQL connection (`sharedSqlConn`)
 * @param store - `gate.auth.apiKeyStore`
 * @param table - Physical table (`oke_api_keys` in `public`)
 */
export async function bindHostApiKeySql(
  conn: SqlConnection,
  store: ApiKeyStore,
  table: string = AUTH_TABLES.apiKeys,
): Promise<void> {
  await ensureApiKeyTable(conn, table);
  const exec = apiKeySqlExec(conn);
  await hydrateApiKeyStore(exec, store, table);
  if (!store.persist) bindApiKeySqlPersist(store, exec, table);
}

/**
 * Bind host key persist through {@link HostApiKeySqlRuntime.primarySql}.
 *
 * No-ops when the store runtime has no SQL driver (in-memory-only apps).
 *
 * @param runtime - Booted `store` element
 * @param store - `gate.auth.apiKeyStore`
 */
export async function bindHostApiKeySqlFromStore(
  runtime: HostApiKeySqlRuntime,
  store: ApiKeyStore,
): Promise<void> {
  const conn = await runtime.primarySql();
  if (!conn) return;
  await bindHostApiKeySql(conn, store);
}

function rowFromSql(raw: Record<string, unknown>): ApiKeyRow | null {
  const id = asString(raw.id ?? raw.ID);
  const plane = raw.plane === "operator" ? "operator" : "user";
  const hash = asString(raw.hash);
  const name = asString(raw.name);
  const creatorId = asString(raw.creator_id ?? raw.creatorId);
  if (!id || !hash || !name || !creatorId) return null;
  return {
    id,
    plane,
    hash,
    name,
    scopes: asStringArray(raw.scopes),
    expiresAt: asNumberOrNull(raw.expires_at ?? raw.expiresAt),
    rateLimit: asRateLimit(raw.rate_limit ?? raw.rateLimit),
    ipAllowlist: asStringArray(raw.ip_allowlist ?? raw.ipAllowlist),
    creatorId,
    creatorScopes: asStringArray(raw.creator_scopes ?? raw.creatorScopes),
    createdAt: asNumberOrNull(raw.created_at ?? raw.createdAt) ?? 0,
    lastUsedAt: asNumberOrNull(raw.last_used_at ?? raw.lastUsedAt),
    revokedAt: asNumberOrNull(raw.revoked_at ?? raw.revokedAt),
    ...(asString(raw.tenant_id ?? raw.tenantId) !== null
      ? { tenantId: asString(raw.tenant_id ?? raw.tenantId) }
      : {}),
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

function asRateLimit(value: unknown): { max: number; per: string } | null {
  const parsed: unknown =
    typeof value === "string" && value.length > 0
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as { max?: unknown; per?: unknown };
  if (typeof rec.max === "number" && typeof rec.per === "string") {
    return { max: rec.max, per: rec.per };
  }
  return null;
}
