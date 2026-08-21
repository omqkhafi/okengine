/**
 * SQL persist / hydrate for {@link ApiKeyRow} on `oke_api_keys`.
 */

import type { ApiKeyRow } from "./tables.ts";
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
 */
export async function persistApiKeyRow(sql: ApiKeySqlExec, row: ApiKeyRow): Promise<void> {
  await sql.execute(
    `INSERT INTO oke_api_keys (
      id, plane, hash, name, scopes, expires_at, rate_limit, ip_allowlist,
      creator_id, creator_scopes, created_at, last_used_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      hash = excluded.hash,
      name = excluded.name,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      rate_limit = excluded.rate_limit,
      ip_allowlist = excluded.ip_allowlist,
      last_used_at = excluded.last_used_at,
      revoked_at = excluded.revoked_at`,
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
    ],
  );
}

/**
 * Load every key row from `oke_api_keys` into a store.
 *
 * @param sql - Executor
 * @param store - Destination store
 */
export async function hydrateApiKeyStore(sql: ApiKeySqlExec, store: ApiKeyStore): Promise<void> {
  const rows = await sql.all(`SELECT * FROM oke_api_keys`);
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
 */
export function bindApiKeySqlPersist(store: ApiKeyStore, sql: ApiKeySqlExec): void {
  store.persist = (row) => persistApiKeyRow(sql, row);
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
