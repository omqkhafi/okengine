/**
 * Durable operator plane for Console — `.oke/console.sqlite` + secret file.
 *
 * Spec: wizard closes permanently once the first operator exists (console §2.5).
 * Claim codes stay ephemeral; operators, sessions, and the signing secret must
 * survive restarts.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
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

/** Relative paths under project cwd. */
export const CONSOLE_OKE_DIR = ".oke";
export const CONSOLE_SQLITE_NAME = "console.sqlite";
export const CONSOLE_SECRET_NAME = "console.secret";

/** Opened Console persistence handle. */
export interface ConsolePersistence {
  /** Stable signing secret. */
  readonly secret: string;
  /** Hydrated operator Maps. */
  readonly operators: OperatorStore;
  /** Hydrated session + refresh Maps. */
  readonly sessions: SessionStore;
  /** Persist (or update) one operator + credential + roles/sso. */
  readonly persistOperator: (operatorId: string) => void;
  /** Persist the full session store (issue / revoke). */
  readonly persistSessions: () => void;
  /** Close the SQLite connection. */
  readonly close: () => void;
}

/**
 * Ensure `.oke/` exists and return absolute paths.
 *
 * @param cwd - Project root
 */
export function consoleOkePaths(cwd: string): {
  readonly dir: string;
  readonly sqlite: string;
  readonly secret: string;
} {
  const dir = join(cwd, CONSOLE_OKE_DIR);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    sqlite: join(dir, CONSOLE_SQLITE_NAME),
    secret: join(dir, CONSOLE_SECRET_NAME),
  };
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
 * @param options - Optional env secret override
 */
export async function openConsolePersistence(
  cwd: string,
  options: { readonly envSecret?: string } = {},
): Promise<ConsolePersistence> {
  const paths = consoleOkePaths(cwd);
  const secret = await resolveConsoleSecret(cwd, options.envSecret);
  const db = new Database(paths.sqlite, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  migrateOperatorSchema(db);
  const operators = loadOperatorStore(db);
  const sessions = loadSessionStore(db);

  return {
    secret,
    operators,
    sessions,
    persistOperator(operatorId: string) {
      persistOperator(db, operators, operatorId);
    },
    persistSessions() {
      persistSessions(db, sessions);
    },
    close() {
      db.close();
    },
  };
}

/**
 * Create operator tables if missing.
 *
 * @param db - bun:sqlite database
 */
export function migrateOperatorSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.operators} (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.operatorCredentials} (
      operator_id TEXT PRIMARY KEY NOT NULL,
      password_hash TEXT NOT NULL,
      login_enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (operator_id) REFERENCES ${AUTH_TABLES.operators}(id)
    );
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.operatorSsoLinks} (
      operator_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      PRIMARY KEY (operator_id, provider, subject),
      FOREIGN KEY (operator_id) REFERENCES ${AUTH_TABLES.operators}(id)
    );
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.operatorRoles} (
      operator_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (operator_id, role),
      FOREIGN KEY (operator_id) REFERENCES ${AUTH_TABLES.operators}(id)
    );
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.sessions} (
      id TEXT PRIMARY KEY NOT NULL,
      plane TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLES.refreshTokens} (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      revoked_at INTEGER
    );
  `);
}

/**
 * Hydrate a {@link SessionStore} from SQLite.
 *
 * @param db - Open database
 */
export function loadSessionStore(db: Database): SessionStore {
  const store = createSessionStore();

  const sessionRows = db
    .query(
      `SELECT id, plane, principal_id, family_id, revoked_at, created_at, expires_at
       FROM ${AUTH_TABLES.sessions}`,
    )
    .all() as Array<{
    id: string;
    plane: SessionRow["plane"];
    principal_id: string;
    family_id: string;
    revoked_at: number | null;
    created_at: number;
    expires_at: number;
  }>;

  for (const row of sessionRows) {
    const session: SessionRow = {
      id: row.id,
      plane: row.plane,
      principalId: row.principal_id,
      familyId: row.family_id,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
    store.sessions.set(session.id, session);
  }

  const refreshRows = db
    .query(
      `SELECT id, session_id, family_id, hash, expires_at, used_at, revoked_at
       FROM ${AUTH_TABLES.refreshTokens}`,
    )
    .all() as Array<{
    id: string;
    session_id: string;
    family_id: string;
    hash: string;
    expires_at: number;
    used_at: number | null;
    revoked_at: number | null;
  }>;

  for (const row of refreshRows) {
    const token: RefreshTokenRow = {
      id: row.id,
      sessionId: row.session_id,
      familyId: row.family_id,
      hash: row.hash,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
    };
    store.refresh.set(token.id, token);
  }

  return store;
}

/**
 * Replace session tables with the in-memory store snapshot.
 *
 * @param db - Open database
 * @param store - In-memory session store
 */
export function persistSessions(db: Database, store: SessionStore): void {
  db.exec(`DELETE FROM ${AUTH_TABLES.refreshTokens}`);
  db.exec(`DELETE FROM ${AUTH_TABLES.sessions}`);

  const insertSession = db.query(
    `INSERT INTO ${AUTH_TABLES.sessions}
      (id, plane, principal_id, family_id, revoked_at, created_at, expires_at)
     VALUES ($id, $plane, $principal, $family, $revoked, $created, $expires)`,
  );
  for (const session of store.sessions.values()) {
    insertSession.run({
      $id: session.id,
      $plane: session.plane,
      $principal: session.principalId,
      $family: session.familyId,
      $revoked: session.revokedAt,
      $created: session.createdAt,
      $expires: session.expiresAt,
    });
  }

  const insertRefresh = db.query(
    `INSERT INTO ${AUTH_TABLES.refreshTokens}
      (id, session_id, family_id, hash, expires_at, used_at, revoked_at)
     VALUES ($id, $session, $family, $hash, $expires, $used, $revoked)`,
  );
  for (const token of store.refresh.values()) {
    insertRefresh.run({
      $id: token.id,
      $session: token.sessionId,
      $family: token.familyId,
      $hash: token.hash,
      $expires: token.expiresAt,
      $used: token.usedAt,
      $revoked: token.revokedAt,
    });
  }
}

/**
 * Hydrate an {@link OperatorStore} from SQLite.
 *
 * @param db - Open database
 */
export function loadOperatorStore(db: Database): OperatorStore {
  const store = createOperatorStore();

  const opRows = db
    .query(
      `SELECT id, email, name, status, mfa_enabled, invited_by, last_seen_at
       FROM ${AUTH_TABLES.operators}`,
    )
    .all() as Array<{
    id: string;
    email: string;
    name: string;
    status: OperatorRow["status"];
    mfa_enabled: number;
    invited_by: string | null;
    last_seen_at: number | null;
  }>;

  for (const row of opRows) {
    store.operators.set(row.id, {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      mfaEnabled: row.mfa_enabled === 1,
      invitedBy: row.invited_by,
      lastSeenAt: row.last_seen_at,
    });
  }

  const credRows = db
    .query(
      `SELECT operator_id, password_hash, login_enabled
       FROM ${AUTH_TABLES.operatorCredentials}`,
    )
    .all() as Array<{
    operator_id: string;
    password_hash: string;
    login_enabled: number;
  }>;

  for (const row of credRows) {
    const cred: OperatorCredentialRow = {
      operatorId: row.operator_id,
      passwordHash: row.password_hash,
      loginEnabled: row.login_enabled === 1,
    };
    store.credentials.set(row.operator_id, cred);
  }

  const ssoRows = db
    .query(`SELECT operator_id, provider, subject FROM ${AUTH_TABLES.operatorSsoLinks}`)
    .all() as Array<{
    operator_id: string;
    provider: string;
    subject: string;
  }>;

  for (const row of ssoRows) {
    const link: OperatorSsoLinkRow = {
      operatorId: row.operator_id,
      provider: row.provider,
      subject: row.subject,
    };
    const list = store.ssoLinks.get(row.operator_id) ?? [];
    list.push(link);
    store.ssoLinks.set(row.operator_id, list);
  }

  const roleRows = db
    .query(`SELECT operator_id, role FROM ${AUTH_TABLES.operatorRoles}`)
    .all() as Array<{ operator_id: string; role: string }>;

  for (const row of roleRows) {
    const list = store.roles.get(row.operator_id) ?? [];
    list.push(row.role);
    store.roles.set(row.operator_id, list);
  }

  return store;
}

/**
 * Upsert one operator (and related rows) from the in-memory store.
 *
 * @param db - Open database
 * @param store - In-memory store
 * @param operatorId - Operator id
 */
export function persistOperator(db: Database, store: OperatorStore, operatorId: string): void {
  const op = store.operators.get(operatorId);
  if (!op) {
    throw new Error(`oke console: unknown operator ${operatorId}`);
  }
  const cred = store.credentials.get(operatorId);
  if (!cred) {
    throw new Error(`oke console: missing credential for ${operatorId}`);
  }

  const upsertOp = db.query(
    `INSERT INTO ${AUTH_TABLES.operators}
      (id, email, name, status, mfa_enabled, invited_by, last_seen_at)
     VALUES ($id, $email, $name, $status, $mfa, $invited, $seen)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       status = excluded.status,
       mfa_enabled = excluded.mfa_enabled,
       invited_by = excluded.invited_by,
       last_seen_at = excluded.last_seen_at`,
  );
  upsertOp.run({
    $id: op.id,
    $email: op.email,
    $name: op.name,
    $status: op.status,
    $mfa: op.mfaEnabled ? 1 : 0,
    $invited: op.invitedBy,
    $seen: op.lastSeenAt,
  });

  const upsertCred = db.query(
    `INSERT INTO ${AUTH_TABLES.operatorCredentials}
      (operator_id, password_hash, login_enabled)
     VALUES ($id, $hash, $enabled)
     ON CONFLICT(operator_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       login_enabled = excluded.login_enabled`,
  );
  upsertCred.run({
    $id: cred.operatorId,
    $hash: cred.passwordHash,
    $enabled: cred.loginEnabled ? 1 : 0,
  });

  db.query(`DELETE FROM ${AUTH_TABLES.operatorSsoLinks} WHERE operator_id = $id`).run({
    $id: operatorId,
  });
  const insertSso = db.query(
    `INSERT INTO ${AUTH_TABLES.operatorSsoLinks} (operator_id, provider, subject)
     VALUES ($id, $provider, $subject)`,
  );
  for (const link of store.ssoLinks.get(operatorId) ?? []) {
    insertSso.run({
      $id: link.operatorId,
      $provider: link.provider,
      $subject: link.subject,
    });
  }

  db.query(`DELETE FROM ${AUTH_TABLES.operatorRoles} WHERE operator_id = $id`).run({
    $id: operatorId,
  });
  const insertRole = db.query(
    `INSERT INTO ${AUTH_TABLES.operatorRoles} (operator_id, role)
     VALUES ($id, $role)`,
  );
  for (const role of store.roles.get(operatorId) ?? []) {
    insertRole.run({ $id: operatorId, $role: role });
  }
}
