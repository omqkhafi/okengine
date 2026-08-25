/**
 * SQL persist / hydrate for {@link UserIdentityRow} + {@link UserAccountRow}.
 *
 * Host path: public schema on the app `store.sql()` connection
 * (`sharedSqlConn` / `DATABASE_URL`), mirroring `api-key-sql.ts`.
 * The identity store hydrates `oke_identities` / `oke_credentials` at host
 * boot and write-through-persists every user/account row thereafter.
 */

import type { SqlConnection } from "../drivers/types.ts";
import { AUTH_TABLES } from "./tables.ts";
import type { IdentityStore, UserAccountRow, UserIdentityRow } from "./identity.ts";

/** Minimal SQL executor for the identity tables. */
export interface IdentitySqlExec {
  execute(sql: string, params: readonly unknown[]): Promise<void>;
  all(sql: string): Promise<readonly Record<string, unknown>[]>;
}

const USER_COLUMNS = "id, email, name, email_verified, status, created_at, updated_at, extra_json";
const ACCOUNT_COLUMNS =
  "id, user_id, provider, provider_account_id, password_hash, created_at, updated_at";

/**
 * Persist one user row to `oke_identities`.
 *
 * @param sql - Executor
 * @param row - User row
 * @param table - Physical table
 */
export async function persistIdentityUserRow(
  sql: IdentitySqlExec,
  row: UserIdentityRow,
  table: string = AUTH_TABLES.identities,
): Promise<void> {
  await sql.execute(
    `INSERT INTO ${table} (${USER_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       email_verified = excluded.email_verified,
       status = excluded.status,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       extra_json = excluded.extra_json`,
    [
      row.id,
      row.email,
      row.name,
      row.emailVerified ? 1 : 0,
      row.status,
      row.createdAt,
      row.updatedAt,
      JSON.stringify(row.extra),
    ],
  );
}

/**
 * Persist one account row to `oke_credentials`.
 *
 * @param sql - Executor
 * @param row - Account row
 * @param table - Physical table
 */
export async function persistIdentityAccountRow(
  sql: IdentitySqlExec,
  row: UserAccountRow,
  table: string = AUTH_TABLES.credentials,
): Promise<void> {
  await sql.execute(
    `INSERT INTO ${table} (${ACCOUNT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       provider = excluded.provider,
       provider_account_id = excluded.provider_account_id,
       password_hash = excluded.password_hash,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      row.id,
      row.userId,
      row.provider,
      row.providerAccountId,
      row.passwordHash,
      row.createdAt,
      row.updatedAt,
    ],
  );
}

/**
 * Bind write-through persist hooks on a store.
 *
 * @param store - Identity store
 * @param sql - Executor
 * @param userTable - Physical `oke_identities`
 * @param accountTable - Physical `oke_credentials`
 */
export function bindIdentitySqlPersist(
  store: IdentityStore,
  sql: IdentitySqlExec,
  userTable: string = AUTH_TABLES.identities,
  accountTable: string = AUTH_TABLES.credentials,
): void {
  store.persistUser = (row) => persistIdentityUserRow(sql, row, userTable);
  store.persistAccount = (row) => persistIdentityAccountRow(sql, row, accountTable);
}

/**
 * Load every identity + credential row into a store, rebuilding derived maps.
 *
 * @param sql - Executor
 * @param store - Destination store
 * @param userTable - Physical `oke_identities`
 * @param accountTable - Physical `oke_credentials`
 */
export async function hydrateIdentityStore(
  sql: IdentitySqlExec,
  store: IdentityStore,
  userTable: string = AUTH_TABLES.identities,
  accountTable: string = AUTH_TABLES.credentials,
): Promise<void> {
  const users = await sql.all(`SELECT * FROM ${userTable}`);
  for (const raw of users) {
    const row = userFromSql(raw);
    if (!row) continue;
    store.users.set(row.id, row);
    if (row.email) store.byEmail.set(normalizeKey(row.email), row.id);
  }
  const accounts = await sql.all(`SELECT * FROM ${accountTable}`);
  for (const raw of accounts) {
    const row = accountFromSql(raw);
    if (!row) continue;
    store.accounts.set(row.id, row);
    store.byProvider.set(`${row.provider}:${row.providerAccountId}`, row.id);
  }
}

/**
 * Create public `oke_identities` / `oke_credentials` when missing.
 *
 * @param conn - Shared SQL connection
 * @param userTable - Physical table
 * @param accountTable - Physical table
 */
export async function ensureIdentityTables(
  conn: SqlConnection,
  userTable: string = AUTH_TABLES.identities,
  accountTable: string = AUTH_TABLES.credentials,
): Promise<void> {
  await conn.exec(
    `CREATE TABLE IF NOT EXISTS ${userTable} (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      extra_json TEXT NOT NULL DEFAULT '{}'
    )`,
  );
  await conn.exec(
    `CREATE TABLE IF NOT EXISTS ${accountTable} (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      password_hash TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
  );
  await conn.exec(
    `CREATE INDEX IF NOT EXISTS ${accountTable}_provider_idx ON ${accountTable} (provider, provider_account_id)`,
  );
  await conn.exec(
    `CREATE INDEX IF NOT EXISTS ${accountTable}_user_idx ON ${accountTable} (user_id)`,
  );
}

/** Runtime that can open the app's shared primary SQL connection. */
export interface HostIdentitySqlRuntime {
  primarySql(): Promise<SqlConnection | undefined>;
}

/**
 * Adapt a driver connection to {@link IdentitySqlExec}.
 *
 * @param conn - Shared `store.sql()` connection
 */
export function identitySqlExec(conn: SqlConnection): IdentitySqlExec {
  return {
    execute: async (sql, params) => {
      await conn.exec(sql, params);
    },
    all: async (sql) => conn.query(sql),
  };
}

/**
 * Hydrate and write-through-persist a host {@link IdentityStore} on `conn`.
 *
 * Leaves already-bound `persist` hooks in place (injected test stores).
 *
 * @param conn - App SQL connection (`sharedSqlConn`)
 * @param store - `gate.auth.identities`
 */
export async function bindHostIdentitySql(
  conn: SqlConnection,
  store: IdentityStore,
): Promise<void> {
  await ensureIdentityTables(conn);
  const exec = identitySqlExec(conn);
  await hydrateIdentityStore(exec, store);
  if (!store.persistUser || !store.persistAccount) {
    bindIdentitySqlPersist(store, exec);
  }
}

/**
 * Bind host identity persist through {@link HostIdentitySqlRuntime.primarySql}.
 *
 * No-ops when the store runtime has no SQL driver (in-memory-only apps).
 *
 * @param runtime - Booted `store` element
 * @param store - `gate.auth.identities`
 */
export async function bindHostIdentitySqlFromStore(
  runtime: HostIdentitySqlRuntime,
  store: IdentityStore,
): Promise<void> {
  const conn = await runtime.primarySql();
  if (!conn) return;
  await bindHostIdentitySql(conn, store);
}

function userFromSql(raw: Record<string, unknown>): UserIdentityRow | null {
  const id = asString(raw.id ?? raw.ID);
  const email = asString(raw.email);
  if (!id || !email) return null;
  return {
    id,
    email,
    name: asString(raw.name) ?? "",
    emailVerified: asBool(raw.email_verified ?? raw.emailVerified),
    status: raw.status === "suspended" ? "suspended" : "active",
    createdAt: asNumber(raw.created_at ?? raw.createdAt),
    updatedAt: asNumber(raw.updated_at ?? raw.updatedAt),
    extra: asExtra(raw.extra_json ?? raw.extra),
  };
}

function accountFromSql(raw: Record<string, unknown>): UserAccountRow | null {
  const id = asString(raw.id ?? raw.ID);
  const userId = asString(raw.user_id ?? raw.userId);
  const provider = asString(raw.provider);
  const providerAccountId = asString(raw.provider_account_id ?? raw.providerAccountId);
  if (!id || !userId || !provider || !providerAccountId) return null;
  return {
    id,
    userId,
    provider,
    providerAccountId,
    passwordHash: asNullableString(raw.password_hash ?? raw.passwordHash),
    createdAt: asNumber(raw.created_at ?? raw.createdAt),
    updatedAt: asNumber(raw.updated_at ?? raw.updatedAt),
  };
}

function normalizeKey(email: string): string {
  return email.trim().toLowerCase();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

function asExtra(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}
