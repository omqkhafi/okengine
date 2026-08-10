/**
 * Vault SQL storage — DDL, audit retention, and chain verification.
 *
 * Statements are raw SQL strings against a minimal {@link SqlExec} surface
 * so the same DDL runs on `postgres.js`, PGlite, or any thin wrapper. All
 * DDL is `IF NOT EXISTS` and therefore safe to run on every boot.
 *
 * Ciphertext columns are `bytea`; nothing in this module ever sees a
 * cleartext value or a key.
 */

import { AUDIT_GENESIS_HASH, computeAuditRowHash, toAuditHashPayload } from "./audit.ts";
import type { AuditAction, AuditEntry, AuditWriter } from "./audit.ts";
import { VaultError } from "./errors.ts";
import type { VaultErrorCode } from "./errors.ts";
import type { VaultActorType } from "./types.ts";

/**
 * Minimal SQL surface the Vault needs.
 *
 * Placeholders are Postgres-style (`$1`, `$2`, …).
 */
export interface SqlExec {
  /**
   * Run a statement and return its rows.
   *
   * @param sql - Statement text
   * @param params - Positional parameters
   */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run a statement, discarding rows.
   *
   * @param sql - Statement text
   * @param params - Positional parameters
   */
  execute(sql: string, params?: unknown[]): Promise<void>;
  /**
   * Optional transactional scope — required for `FOR UPDATE` / `SKIP LOCKED`
   * lease and audit serialization (Clock / Signal class).
   *
   * @param fn - Work that must see a single snapshot under row locks
   */
  begin?<T>(fn: (tx: SqlExec) => Promise<T>): Promise<T>;
}

/**
 * Run `fn` inside {@link SqlExec.begin} when available.
 *
 * @param db - SQL surface
 * @param fn - Transactional work
 */
export async function withSqlTransaction<T>(
  db: SqlExec,
  fn: (tx: SqlExec) => Promise<T>,
): Promise<T> {
  if (db.begin) return db.begin(fn);
  return fn(db);
}

/** Encrypted secret versions. One row per `(path, version)`. */
export const CREATE_SECRETS_TABLE = `
CREATE TABLE IF NOT EXISTS oke_vault_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL,
  encrypted_value bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm text NOT NULL DEFAULT 'aes-256-gcm',
  kek_version integer NOT NULL DEFAULT 1,
  key_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT oke_vault_secrets_path_version_key UNIQUE (path, version)
)`;

/** Per-secret wrapped DEKs. One live row per secret version. */
export const CREATE_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS oke_vault_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id uuid NOT NULL REFERENCES oke_vault_secrets(id) ON DELETE CASCADE,
  encrypted_dek bytea NOT NULL,
  dek_iv bytea NOT NULL,
  dek_auth_tag bytea NOT NULL,
  dek_salt bytea,
  algorithm text NOT NULL DEFAULT 'aes-256-gcm',
  kek_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
)`;

/**
 * Tamper-evident operation log. Never holds a secret value.
 *
 * `seq` — not `created_at` — defines chain order. Two appends inside the
 * same millisecond share a timestamp, and `id` is a random uuid, so any
 * `(created_at, id)` ordering can disagree with insertion order and make an
 * intact chain look broken.
 */
export const CREATE_AUDIT_TABLE = `
CREATE TABLE IF NOT EXISTS oke_vault_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  action text NOT NULL,
  path text,
  actor_type text NOT NULL DEFAULT 'unknown',
  actor_id text,
  success boolean NOT NULL DEFAULT true,
  error_code text,
  error_message text,
  request_id text,
  prev_hash text,
  row_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;

/** Master-key record. Holds a verification hash, never the key. */
export const CREATE_MASTER_TABLE = `
CREATE TABLE IF NOT EXISTS oke_vault_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL,
  wrapped_master bytea,
  kms_key_id text,
  kek_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

/** Singleton operational state (`id = 1`). */
export const CREATE_STATUS_TABLE = `
CREATE TABLE IF NOT EXISTS oke_vault_status (
  id integer PRIMARY KEY DEFAULT 1,
  sealed boolean NOT NULL DEFAULT true,
  initialized boolean NOT NULL DEFAULT false,
  master_key_present boolean NOT NULL DEFAULT false,
  last_sealed_at timestamptz,
  last_unsealed_at timestamptz,
  seal_count integer NOT NULL DEFAULT 0,
  rewrap_checkpoint text,
  rewrap_target_kek_version integer,
  rewrap_key_hash text,
  rotate_locked_by text,
  rotate_lease_expires_at bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oke_vault_status_singleton CHECK (id = 1)
)`;

/**
 * Claim the rotate-master lease — same predicate as Clock/Signal
 * (`FOR UPDATE SKIP LOCKED` + lease-expiry reclaim).
 */
export const CLAIM_ROTATE_LEASE_SQL: string = `SELECT id FROM oke_vault_status WHERE id = 1 AND ((rotate_locked_by IS NULL) OR (rotate_locked_by = $1) OR (rotate_lease_expires_at IS NULL) OR (rotate_lease_expires_at <= $2)) FOR UPDATE SKIP LOCKED`;

/** Default rotate-master lease TTL (ms) — lazy reclaim, no sweeper. */
export const DEFAULT_ROTATE_LEASE_MS: number = 30_000;

/** Index / seed statements applied after the tables exist. */
const POST_DDL_STATEMENTS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS oke_vault_secrets_path_idx ON oke_vault_secrets (path) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS oke_vault_secrets_expires_idx ON oke_vault_secrets (expires_at) WHERE expires_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS oke_vault_keys_secret_idx ON oke_vault_keys (secret_id)`,
  `CREATE INDEX IF NOT EXISTS oke_vault_keys_kek_version_idx ON oke_vault_keys (kek_version)`,
  `ALTER TABLE oke_vault_audit ADD COLUMN IF NOT EXISTS seq bigserial NOT NULL`,
  `ALTER TABLE oke_vault_status ADD COLUMN IF NOT EXISTS rewrap_key_hash text`,
  `ALTER TABLE oke_vault_status ADD COLUMN IF NOT EXISTS rotate_locked_by text`,
  `ALTER TABLE oke_vault_status ADD COLUMN IF NOT EXISTS rotate_lease_expires_at bigint`,
  `CREATE INDEX IF NOT EXISTS oke_vault_audit_seq_idx ON oke_vault_audit (seq)`,
  `CREATE INDEX IF NOT EXISTS oke_vault_audit_created_idx ON oke_vault_audit (created_at, id)`,
  `CREATE INDEX IF NOT EXISTS oke_vault_audit_path_idx ON oke_vault_audit (path)`,
  `INSERT INTO oke_vault_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
];

/** Every Vault table in dependency order. */
export const VAULT_DDL_STATEMENTS: readonly string[] = [
  CREATE_SECRETS_TABLE,
  CREATE_KEYS_TABLE,
  CREATE_AUDIT_TABLE,
  CREATE_MASTER_TABLE,
  CREATE_STATUS_TABLE,
];

/**
 * Create every Vault table, index, and the status singleton.
 *
 * Idempotent — safe to call on every boot.
 *
 * @param db - SQL surface
 * @throws VaultError `BACKEND_ERROR` when the backend rejects the DDL
 */
export async function ensureVaultTables(db: SqlExec): Promise<void> {
  for (const sql of [...VAULT_DDL_STATEMENTS, ...POST_DDL_STATEMENTS]) {
    try {
      await db.execute(sql);
    } catch {
      // Never surface the driver error verbatim: it can echo row contents.
      throw new VaultError("BACKEND_ERROR", "vault: failed to ensure vault tables");
    }
  }
}

/**
 * Delete audit rows older than `before`.
 *
 * Purging is a deliberate break in the hash chain: the oldest retained row
 * keeps a `prev_hash` that no longer resolves. {@link verifyAuditChain}
 * treats the first retained row as a chain anchor for this reason.
 *
 * @param db - SQL surface
 * @param before - Exclusive upper bound on `created_at`
 * @returns Number of rows removed
 */
export async function purgeAuditBefore(db: SqlExec, before: Date): Promise<number> {
  try {
    const rows = await db.query<{ id: string }>(
      `DELETE FROM oke_vault_audit WHERE created_at < $1 RETURNING id`,
      [before],
    );
    return rows.length;
  } catch {
    throw new VaultError("BACKEND_ERROR", "vault: failed to purge audit rows");
  }
}

/** Result of {@link purgeExpiredSecrets}. */
export interface PurgeExpiredResult {
  /** Rows matched (deleted, or counted on dry-run). */
  readonly count: number;
  /** Distinct secret paths among those rows. */
  readonly paths: readonly string[];
}

/**
 * Hard-delete secret versions whose `expires_at` is strictly before `before`.
 *
 * Independent of soft-delete (`deleted_at`). Wrapped DEK rows cascade via
 * `oke_vault_keys.secret_id ON DELETE CASCADE`.
 *
 * @param db - SQL surface
 * @param before - Exclusive upper bound on `expires_at`
 * @param dryRun - When true, count only
 */
export async function purgeExpiredSecrets(
  db: SqlExec,
  before: Date,
  dryRun: boolean,
): Promise<PurgeExpiredResult> {
  try {
    const rows = dryRun
      ? await db.query<{ path: string }>(
          `SELECT path FROM oke_vault_secrets
           WHERE expires_at IS NOT NULL AND expires_at < $1`,
          [before],
        )
      : await db.query<{ path: string }>(
          `DELETE FROM oke_vault_secrets
           WHERE expires_at IS NOT NULL AND expires_at < $1
           RETURNING path`,
          [before],
        );
    const paths = [...new Set(rows.map((r) => r.path))].sort();
    return { count: rows.length, paths };
  } catch {
    throw new VaultError("BACKEND_ERROR", "vault: failed to purge expired secrets");
  }
}

/** Filters for {@link readAuditPage}. */
export interface AuditPageOptions {
  /** Maximum rows to return, newest first. Defaults to 50. */
  readonly limit?: number;
  /** Restrict to one canonical path. */
  readonly path?: string;
}

/**
 * One audit row as surfaced to an operator.
 *
 * Mirrors the stored columns minus the chain hashes — a row records that
 * something happened to a path, never what the value was.
 */
export interface VaultAuditRecord {
  /** Row id. */
  readonly id: string;
  /** Insertion order. */
  readonly seq: number;
  /** What happened. */
  readonly action: AuditAction;
  /** Canonical path, when the operation targeted one. */
  readonly path: string | null;
  /** Actor class. */
  readonly actorType: VaultActorType;
  /** Actor id within its class. */
  readonly actorId: string | null;
  /** Whether the operation succeeded. */
  readonly success: boolean;
  /** Failure reason when `success` is `false`. */
  readonly errorCode: VaultErrorCode | null;
  /** Secret-free failure description. */
  readonly errorMessage: string | null;
  /** Correlation id for the enclosing request/run. */
  readonly requestId: string | null;
  /** Event time. */
  readonly createdAt: Date;
}

/**
 * Read the newest audit rows.
 *
 * @param db - SQL surface
 * @param options - Limit / path filter
 */
export async function readAuditPage(
  db: SqlExec,
  options: AuditPageOptions = {},
): Promise<readonly VaultAuditRecord[]> {
  const params: unknown[] = [];
  let where = "";
  if (options.path !== undefined) {
    params.push(options.path);
    where = `WHERE path = $${params.length}`;
  }
  params.push(Math.max(1, Math.floor(options.limit ?? 50)));

  let rows: (AuditDbRow & { seq: number | string | bigint })[];
  try {
    rows = await db.query(
      `SELECT id, seq, action, path, actor_type, actor_id, success, error_code, error_message,
              request_id, prev_hash, row_hash, created_at
       FROM oke_vault_audit ${where}
       ORDER BY seq DESC LIMIT $${params.length}`,
      params,
    );
  } catch {
    throw new VaultError("BACKEND_ERROR", "vault: failed to read audit rows");
  }

  return rows.map((row) => ({
    id: row.id,
    seq: typeof row.seq === "number" ? row.seq : Number(row.seq),
    action: row.action as AuditAction,
    path: row.path,
    actorType: row.actor_type as VaultActorType,
    actorId: row.actor_id,
    success: row.success === true || row.success === 1,
    errorCode: row.error_code as VaultErrorCode | null,
    errorMessage: row.error_message,
    requestId: row.request_id,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }));
}

/** Result of {@link verifyAuditChain}. */
export interface AuditChainResult {
  /** Whether every retained row hashes and links correctly. */
  readonly ok: boolean;
  /** Id of the first row that failed verification. */
  readonly brokenAt?: string;
}

/** Raw `oke_vault_audit` row shape. */
interface AuditDbRow {
  id: string;
  action: string;
  path: string | null;
  actor_type: string;
  actor_id: string | null;
  success: boolean | number;
  error_code: string | null;
  error_message: string | null;
  request_id: string | null;
  prev_hash: string | null;
  row_hash: string;
  created_at: Date | string;
}

/**
 * Walk the audit chain and report the first broken row.
 *
 * Each row is re-hashed from its stored `prev_hash` and payload; the result
 * must equal the stored `row_hash`. Consecutive rows must additionally link
 * (`row[n].prev_hash === row[n-1].row_hash`). The oldest retained row is an
 * anchor — its `prev_hash` may point at a purged predecessor.
 *
 * Rows are walked in `seq` order, which is insertion order even when several
 * appends share a `created_at`.
 *
 * @param db - SQL surface
 */
export async function verifyAuditChain(db: SqlExec): Promise<AuditChainResult> {
  let rows: AuditDbRow[];
  try {
    rows = await db.query<AuditDbRow>(
      `SELECT id, action, path, actor_type, actor_id, success, error_code, error_message, request_id, prev_hash, row_hash, created_at
       FROM oke_vault_audit ORDER BY seq ASC`,
    );
  } catch {
    throw new VaultError("BACKEND_ERROR", "vault: failed to read audit rows");
  }

  let previousHash: string | undefined;
  for (const row of rows) {
    if (previousHash !== undefined && row.prev_hash !== previousHash) {
      return { ok: false, brokenAt: row.id };
    }
    const expected = await computeAuditRowHash(row.prev_hash, {
      action: row.action as AuditAction,
      path: row.path,
      actorType: row.actor_type as VaultActorType,
      actorId: row.actor_id,
      success: row.success === true || row.success === 1,
      errorCode: row.error_code as VaultErrorCode | null,
      errorMessage: row.error_message,
      requestId: row.request_id,
      createdAt: toIso(row.created_at),
    });
    if (expected !== row.row_hash) {
      return { ok: false, brokenAt: row.id };
    }
    previousHash = row.row_hash;
  }
  return { ok: true };
}

/**
 * Acquire the rotate-master lease (Clock/Signal SKIP LOCKED + lease-expiry).
 *
 * Exactly one concurrent claimant wins; losers get `false` immediately
 * (no wait). A crashed holder's lease is reclaimed lazily when
 * `rotate_lease_expires_at <= now`.
 *
 * @param db - SQL surface (uses {@link SqlExec.begin} when present)
 * @param holderId - Claimant id (per rotation attempt)
 * @param now - Epoch-ms
 * @param leaseMs - Lease TTL
 */
export async function acquireRotateLease(
  db: SqlExec,
  holderId: string,
  now: number,
  leaseMs: number = DEFAULT_ROTATE_LEASE_MS,
): Promise<boolean> {
  return withSqlTransaction(db, async (tx) => {
    const claimed = await tx.query<{ id: number | string }>(CLAIM_ROTATE_LEASE_SQL, [
      holderId,
      now,
    ]);
    if (!claimed[0]) return false;
    await tx.execute(
      `UPDATE oke_vault_status
       SET rotate_locked_by = $1, rotate_lease_expires_at = $2, updated_at = now()
       WHERE id = 1`,
      [holderId, now + leaseMs],
    );
    return true;
  });
}

/**
 * Drop the rotate-master lease when this holder still owns it.
 *
 * @param db - SQL surface
 * @param holderId - Holder that acquired the lease
 */
export async function releaseRotateLease(db: SqlExec, holderId: string): Promise<void> {
  await db.execute(
    `UPDATE oke_vault_status
     SET rotate_locked_by = NULL, rotate_lease_expires_at = NULL, updated_at = now()
     WHERE id = 1 AND rotate_locked_by = $1`,
    [holderId],
  );
}

/**
 * Renew the rotate-master lease for a long rewrap.
 *
 * @param db - SQL surface
 * @param holderId - Current holder
 * @param now - Epoch-ms
 * @param leaseMs - Lease TTL
 */
export async function renewRotateLease(
  db: SqlExec,
  holderId: string,
  now: number,
  leaseMs: number = DEFAULT_ROTATE_LEASE_MS,
): Promise<boolean> {
  return acquireRotateLease(db, holderId, now, leaseMs);
}

/**
 * Backend-side {@link AuditWriter} over `oke_vault_audit`.
 *
 * Appends run inside a transaction that locks the status singleton with
 * `SELECT … FOR UPDATE` so concurrent writers cannot share a `prev_hash`
 * (same exclusivity class as Signal competing consumers).
 *
 * @param db - SQL surface
 */
export function createSqlAuditWriter(db: SqlExec): AuditWriter {
  return {
    async appendAuditEntry(entry: AuditEntry): Promise<void> {
      const createdAt = entry.at ?? new Date();
      const payload = toAuditHashPayload(entry, createdAt);
      try {
        await withSqlTransaction(db, async (tx) => {
          // Serialize writers on the singleton — FOR UPDATE waits, does not skip.
          await tx.query(`SELECT id FROM oke_vault_status WHERE id = 1 FOR UPDATE`);
          const head = await tx.query<{ row_hash: string }>(
            `SELECT row_hash FROM oke_vault_audit ORDER BY seq DESC LIMIT 1`,
          );
          const prevHash = head[0]?.row_hash ?? AUDIT_GENESIS_HASH;
          const rowHash = await computeAuditRowHash(prevHash, payload);
          await tx.execute(
            `INSERT INTO oke_vault_audit
               (action, path, actor_type, actor_id, success, error_code, error_message, request_id, prev_hash, row_hash, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              payload.action,
              payload.path,
              payload.actorType,
              payload.actorId,
              payload.success,
              payload.errorCode,
              payload.errorMessage,
              payload.requestId,
              prevHash,
              rowHash,
              createdAt,
            ],
          );
        });
      } catch (error) {
        if (error instanceof VaultError) throw error;
        throw new VaultError("BACKEND_ERROR", "vault: failed to append audit row");
      }
    },
  };
}

/**
 * Normalize a timestamp column to ISO-8601.
 *
 * @param value - `Date` or driver-supplied string
 */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
