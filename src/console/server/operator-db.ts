/**
 * Durable operator plane for Console — Postgres schema `oke_console` + secret file.
 *
 * Same database as the app (`DATABASE_URL` / `OKE_STORE_SQL_URL`):
 * - `public` — application + shared runtime tables
 * - `oke_console` — Console operators / sessions (never mixed into `public`)
 *
 * When no Postgres URL is set (unit tests), falls back to PGlite under
 * `.oke/console-pg` so reopen durability still works without Docker.
 *
 * Spec: wizard closes permanently once the first operator exists (console §2.5).
 * Claim codes stay out of Postgres (optional local DX mirror: `.oke/claim-code`);
 * operators, sessions, and the signing secret must survive restarts.
 * API keys persist on the host `store.sql()` connection (`public.oke_api_keys`),
 * not in this schema — Console attaches that store via `attachHostToConsole`.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createOperatorStore, type OperatorStore } from "../../auth/operator.ts";
import { createSessionStore, type SessionStore } from "../../auth/sessions.ts";
import type {
  OperatorCredentialRow,
  OperatorRow,
  OperatorSsoLinkRow,
  RefreshTokenRow,
  SessionRow,
} from "../../auth/tables.ts";
import { AUTH_TABLES } from "../../auth/tables.ts";
import type { SqlConnection } from "../../drivers/types.ts";

/** Relative paths under project cwd. */
export const CONSOLE_OKE_DIR = ".oke";
/**
 * Console session HMAC signing secret (local file under `.oke/`).
 * Not a Vault contract — operators/sessions must sign even when Vault is sealed.
 * Override with `OKE_CONSOLE_SECRET` when set.
 */
export const CONSOLE_SECRET_NAME = "console.secret";
/** PGlite datadir when no Postgres URL is configured. */
export const CONSOLE_PGLITE_DIR = "console-pg";
/**
 * Postgres schema for Console operator-plane tables.
 * App domain tables stay in `public` on the same database.
 */
export const CONSOLE_PG_SCHEMA = "oke_console";

/** Opened Console persistence handle. */
export interface ConsolePersistence {
  /** Stable signing secret. */
  readonly secret: string;
  /** Hydrated operator Maps. */
  readonly operators: OperatorStore;
  /** Hydrated session + refresh Maps. */
  readonly sessions: SessionStore;
  /** Persist (or update) one operator + credential + roles/sso. */
  readonly persistOperator: (operatorId: string) => Promise<void>;
  /** Persist the full session store (issue / revoke). */
  readonly persistSessions: () => Promise<void>;
  /** Close the SQL connection. */
  readonly close: () => Promise<void>;
}

/** Options for {@link openConsolePersistence}. */
export interface OpenConsolePersistenceOptions {
  /** Optional `OKE_CONSOLE_SECRET` override. */
  readonly envSecret?: string;
  /** SQL URL override (`DATABASE_URL` / `OKE_STORE_SQL_URL` otherwise). */
  readonly url?: string;
  /** Injected connection (tests). */
  readonly connection?: SqlConnection;
  /** Injected env map (tests). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Ensure `.oke/` exists and return absolute paths.
 *
 * @param cwd - Project root
 */
export function consoleOkePaths(cwd: string): {
  readonly dir: string;
  readonly secret: string;
  readonly pglite: string;
} {
  const dir = join(cwd, CONSOLE_OKE_DIR);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    secret: join(dir, CONSOLE_SECRET_NAME),
    pglite: join(dir, CONSOLE_PGLITE_DIR),
  };
}

/**
 * Qualify a table name inside {@link CONSOLE_PG_SCHEMA}.
 *
 * @param table - Bare table name (`oke_operators`, …)
 */
export function consoleTable(table: string): string {
  return `"${CONSOLE_PG_SCHEMA}"."${table}"`;
}

/**
 * Load or create a stable Console signing secret under `.oke/console.secret`.
 *
 * @param cwd - Project root
 * @param envSecret - Optional `OKE_CONSOLE_SECRET` override
 */
export async function resolveConsoleSecret(cwd: string, envSecret?: string): Promise<string> {
  if (envSecret !== undefined && envSecret.length > 0) return envSecret;
  const paths = consoleOkePaths(cwd);
  const file = Bun.file(paths.secret);
  if (await file.exists()) {
    const existing = (await file.text()).trim();
    if (existing.length > 0) return existing;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await Bun.write(paths.secret, `${secret}\n`);
  return secret;
}

/**
 * Open Console operator DB, migrate schema, hydrate Maps.
 *
 * @param cwd - Project root
 * @param options - Secret / URL / connection overrides
 */
export async function openConsolePersistence(
  cwd: string,
  options: OpenConsolePersistenceOptions = {},
): Promise<ConsolePersistence> {
  const secret = await resolveConsoleSecret(cwd, options.envSecret);
  const env = options.env ?? process.env;
  const url = options.url ?? env.DATABASE_URL ?? env.OKE_STORE_SQL_URL;
  const owned = options.connection === undefined;
  const sql = options.connection ?? (await connectConsoleSql(cwd, url));

  await migrateOperatorSchema(sql);
  const operators = await loadOperatorStore(sql);
  const sessions = await loadSessionStore(sql);

  return {
    secret,
    operators,
    sessions,
    async persistOperator(operatorId: string) {
      await persistOperator(sql, operators, operatorId);
    },
    async persistSessions() {
      await persistSessions(sql, sessions);
    },
    async close() {
      if (owned) await sql.close();
    },
  };
}

/**
 * Open Postgres (shared app URL) or PGlite under `.oke/console-pg`.
 *
 * @param cwd - Project root
 * @param url - Resolved SQL URL, when configured
 */
async function connectConsoleSql(cwd: string, url: string | undefined): Promise<SqlConnection> {
  if (url !== undefined && /^postgres(ql)?:\/\//.test(url)) {
    const { connectPostgres } = await import("../../drivers/postgres.ts");
    return connectPostgres({ url });
  }
  const { connectPglite } = await import("../../drivers/pglite.ts");
  const paths = consoleOkePaths(cwd);
  // Explicit non-postgres URL (tests) wins; otherwise durable PGlite datadir.
  if (url !== undefined && url.length > 0) {
    return connectPglite({ url });
  }
  return connectPglite({ url: paths.pglite });
}

/**
 * Create `oke_console` schema + operator tables if missing.
 *
 * @param sql - SQL connection
 */
export async function migrateOperatorSchema(sql: SqlConnection): Promise<void> {
  await sql.exec(`CREATE SCHEMA IF NOT EXISTS "${CONSOLE_PG_SCHEMA}"`);
  const ops = consoleTable(AUTH_TABLES.operators);
  const creds = consoleTable(AUTH_TABLES.operatorCredentials);
  const sso = consoleTable(AUTH_TABLES.operatorSsoLinks);
  const roles = consoleTable(AUTH_TABLES.operatorRoles);
  const sessions = consoleTable(AUTH_TABLES.sessions);
  const refresh = consoleTable(AUTH_TABLES.refreshTokens);

  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${ops} (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      invited_by TEXT,
      last_seen_at BIGINT
    );
  `);
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${creds} (
      operator_id TEXT PRIMARY KEY NOT NULL,
      password_hash TEXT NOT NULL,
      login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      FOREIGN KEY (operator_id) REFERENCES ${ops}(id)
    );
  `);
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${sso} (
      operator_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      PRIMARY KEY (operator_id, provider, subject),
      FOREIGN KEY (operator_id) REFERENCES ${ops}(id)
    );
  `);
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${roles} (
      operator_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (operator_id, role),
      FOREIGN KEY (operator_id) REFERENCES ${ops}(id)
    );
  `);
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${sessions} (
      id TEXT PRIMARY KEY NOT NULL,
      plane TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      revoked_at BIGINT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      last_active_at BIGINT,
      scopes TEXT NOT NULL DEFAULT '[]',
      audience TEXT
    );
  `);
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS ${refresh} (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used_at BIGINT,
      revoked_at BIGINT
    );
  `);
  await ensureSessionColumns(sql);
}

/**
 * Add session columns when opening an older Console schema.
 *
 * @param sql - Open connection
 */
async function ensureSessionColumns(sql: SqlConnection): Promise<void> {
  const sessions = consoleTable(AUTH_TABLES.sessions);
  await sql.exec(`ALTER TABLE ${sessions} ADD COLUMN IF NOT EXISTS last_active_at BIGINT`);
  await sql.exec(
    `ALTER TABLE ${sessions} ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT '[]'`,
  );
  await sql.exec(`ALTER TABLE ${sessions} ADD COLUMN IF NOT EXISTS audience TEXT`);
}

/**
 * Coerce a SQL boolean / 0|1 cell to boolean.
 *
 * @param value - Driver cell
 */
function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

/**
 * Coerce a SQL numeric cell to number | null.
 *
 * @param value - Driver cell
 */
function asNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hydrate a {@link SessionStore} from SQL.
 *
 * @param sql - Open connection
 */
export async function loadSessionStore(sql: SqlConnection): Promise<SessionStore> {
  const store = createSessionStore();
  const sessions = consoleTable(AUTH_TABLES.sessions);
  const refresh = consoleTable(AUTH_TABLES.refreshTokens);

  const sessionRows = await sql.query(
    `SELECT id, plane, principal_id, family_id, revoked_at, created_at, expires_at, last_active_at, scopes, audience
     FROM ${sessions}`,
  );

  for (const row of sessionRows) {
    let scopes: string[] = [];
    const scopesRaw = row["scopes"];
    if (typeof scopesRaw === "string" && scopesRaw.length > 0) {
      try {
        const parsed = JSON.parse(scopesRaw) as unknown;
        if (Array.isArray(parsed)) scopes = parsed.map(String);
      } catch {
        scopes = [];
      }
    }
    const createdAt = asNum(row["created_at"]) ?? 0;
    const session: SessionRow = {
      id: String(row["id"]),
      plane: row["plane"] as SessionRow["plane"],
      principalId: String(row["principal_id"]),
      familyId: String(row["family_id"]),
      revokedAt: asNum(row["revoked_at"]),
      createdAt,
      expiresAt: asNum(row["expires_at"]) ?? 0,
      lastActiveAt: asNum(row["last_active_at"]) ?? createdAt,
      scopes,
      ...(typeof row["audience"] === "string" && row["audience"].length > 0
        ? { audience: row["audience"] }
        : {}),
    };
    store.sessions.set(session.id, session);
  }

  const refreshRows = await sql.query(
    `SELECT id, session_id, family_id, hash, expires_at, used_at, revoked_at
     FROM ${refresh}`,
  );

  for (const row of refreshRows) {
    const token: RefreshTokenRow = {
      id: String(row["id"]),
      sessionId: String(row["session_id"]),
      familyId: String(row["family_id"]),
      hash: String(row["hash"]),
      expiresAt: asNum(row["expires_at"]) ?? 0,
      usedAt: asNum(row["used_at"]),
      revokedAt: asNum(row["revoked_at"]),
    };
    store.refresh.set(token.id, token);
  }

  return store;
}

/**
 * Replace session tables with the in-memory store snapshot.
 *
 * @param sql - Open connection
 * @param store - In-memory session store
 */
export async function persistSessions(sql: SqlConnection, store: SessionStore): Promise<void> {
  const sessions = consoleTable(AUTH_TABLES.sessions);
  const refresh = consoleTable(AUTH_TABLES.refreshTokens);

  await sql.exec(`DELETE FROM ${refresh}`);
  await sql.exec(`DELETE FROM ${sessions}`);

  for (const session of store.sessions.values()) {
    await sql.exec(
      `INSERT INTO ${sessions}
        (id, plane, principal_id, family_id, revoked_at, created_at, expires_at, last_active_at, scopes, audience)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.plane,
        session.principalId,
        session.familyId,
        session.revokedAt,
        session.createdAt,
        session.expiresAt,
        session.lastActiveAt,
        JSON.stringify(session.scopes ?? []),
        session.audience ?? null,
      ],
    );
  }

  for (const token of store.refresh.values()) {
    await sql.exec(
      `INSERT INTO ${refresh}
        (id, session_id, family_id, hash, expires_at, used_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        token.id,
        token.sessionId,
        token.familyId,
        token.hash,
        token.expiresAt,
        token.usedAt,
        token.revokedAt,
      ],
    );
  }
}

/**
 * Hydrate an {@link OperatorStore} from SQL.
 *
 * @param sql - Open connection
 */
export async function loadOperatorStore(sql: SqlConnection): Promise<OperatorStore> {
  const store = createOperatorStore();
  const ops = consoleTable(AUTH_TABLES.operators);
  const creds = consoleTable(AUTH_TABLES.operatorCredentials);
  const sso = consoleTable(AUTH_TABLES.operatorSsoLinks);
  const roles = consoleTable(AUTH_TABLES.operatorRoles);

  const opRows = await sql.query(
    `SELECT id, email, name, status, mfa_enabled, invited_by, last_seen_at
     FROM ${ops}`,
  );

  for (const row of opRows) {
    store.operators.set(String(row["id"]), {
      id: String(row["id"]),
      email: String(row["email"]),
      name: String(row["name"]),
      status: row["status"] as OperatorRow["status"],
      mfaEnabled: asBool(row["mfa_enabled"]),
      invitedBy: typeof row["invited_by"] === "string" ? row["invited_by"] : null,
      lastSeenAt: asNum(row["last_seen_at"]),
    });
  }

  const credRows = await sql.query(
    `SELECT operator_id, password_hash, login_enabled
     FROM ${creds}`,
  );

  for (const row of credRows) {
    const cred: OperatorCredentialRow = {
      operatorId: String(row["operator_id"]),
      passwordHash: String(row["password_hash"]),
      loginEnabled: asBool(row["login_enabled"]),
    };
    store.credentials.set(cred.operatorId, cred);
  }

  const ssoRows = await sql.query(`SELECT operator_id, provider, subject FROM ${sso}`);

  for (const row of ssoRows) {
    const link: OperatorSsoLinkRow = {
      operatorId: String(row["operator_id"]),
      provider: String(row["provider"]),
      subject: String(row["subject"]),
    };
    const list = store.ssoLinks.get(link.operatorId) ?? [];
    list.push(link);
    store.ssoLinks.set(link.operatorId, list);
  }

  const roleRows = await sql.query(`SELECT operator_id, role FROM ${roles}`);

  for (const row of roleRows) {
    const operatorId = String(row["operator_id"]);
    const list = store.roles.get(operatorId) ?? [];
    list.push(String(row["role"]));
    store.roles.set(operatorId, list);
  }

  return store;
}

/**
 * Upsert one operator (and related rows) from the in-memory store.
 *
 * @param sql - Open connection
 * @param store - In-memory store
 * @param operatorId - Operator id
 */
export async function persistOperator(
  sql: SqlConnection,
  store: OperatorStore,
  operatorId: string,
): Promise<void> {
  const op = store.operators.get(operatorId);
  if (!op) {
    throw new Error(`oke console: unknown operator ${operatorId}`);
  }
  const cred = store.credentials.get(operatorId);
  if (!cred) {
    throw new Error(`oke console: missing credential for ${operatorId}`);
  }

  const ops = consoleTable(AUTH_TABLES.operators);
  const creds = consoleTable(AUTH_TABLES.operatorCredentials);
  const sso = consoleTable(AUTH_TABLES.operatorSsoLinks);
  const roles = consoleTable(AUTH_TABLES.operatorRoles);

  await sql.exec(
    `INSERT INTO ${ops}
      (id, email, name, status, mfa_enabled, invited_by, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       status = EXCLUDED.status,
       mfa_enabled = EXCLUDED.mfa_enabled,
       invited_by = EXCLUDED.invited_by,
       last_seen_at = EXCLUDED.last_seen_at`,
    [op.id, op.email, op.name, op.status, op.mfaEnabled, op.invitedBy, op.lastSeenAt],
  );

  await sql.exec(
    `INSERT INTO ${creds}
      (operator_id, password_hash, login_enabled)
     VALUES (?, ?, ?)
     ON CONFLICT (operator_id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       login_enabled = EXCLUDED.login_enabled`,
    [cred.operatorId, cred.passwordHash, cred.loginEnabled],
  );

  await sql.exec(`DELETE FROM ${sso} WHERE operator_id = ?`, [operatorId]);
  for (const link of store.ssoLinks.get(operatorId) ?? []) {
    await sql.exec(`INSERT INTO ${sso} (operator_id, provider, subject) VALUES (?, ?, ?)`, [
      link.operatorId,
      link.provider,
      link.subject,
    ]);
  }

  await sql.exec(`DELETE FROM ${roles} WHERE operator_id = ?`, [operatorId]);
  for (const role of store.roles.get(operatorId) ?? []) {
    await sql.exec(`INSERT INTO ${roles} (operator_id, role) VALUES (?, ?)`, [operatorId, role]);
  }
}
