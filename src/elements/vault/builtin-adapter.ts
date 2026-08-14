/**
 * Built-in Vault adapter — encrypted-at-rest secrets over plain SQL.
 *
 * One master key (never stored) derives a KEK; every secret version gets its
 * own DEK, wrapped by that KEK. Two AAD bindings guard the envelope:
 *
 * ```text
 * value  AAD = (path, version, algorithm, secrets.kek_version)
 * DEK    AAD = (path, version, algorithm, keys.kek_version)
 * ```
 *
 * They are equal at write time and diverge only during a master rotation:
 * {@link BuiltinVaultAdapter.rotateMaster} re-wraps DEKs under a new KEK
 * generation without touching the value ciphertext, so a rotation never has
 * to decrypt-and-re-encrypt every secret. Reads try the active KEK first and
 * fall back to the pending one, which makes an in-flight rewrap invisible to
 * callers.
 *
 * Every operation appends one row to the tamper-evident audit chain. No
 * cleartext value ever reaches the log, an error message, or a `VaultError`.
 */

import { createAuditSink, type AuditAction, type AuditSink } from "./audit.ts";
import {
  ALGORITHM,
  buildAad,
  constantTimeEqualStrings,
  decryptBytes,
  decryptSecret,
  deriveVerifyHash,
  encryptBytes,
  encryptSecret,
  generateDek,
  generateMasterKey,
  importAesKey,
  masterKeyFromBase64,
  masterKeyToBase64,
  unwrapDek,
  wrapDek,
  zeroBytes,
  type SealedBytes,
} from "./crypto.ts";
import { VaultError } from "./errors.ts";
import { canonicalizePath, canonicalizePrefix } from "./path.ts";
import { createResilientSqlExec } from "./resilience.ts";
import {
  acquireRotateLease,
  createSqlAuditWriter,
  DEFAULT_ROTATE_LEASE_MS,
  ensureVaultTables,
  purgeAuditBefore as purgeAuditRows,
  purgeExpiredSecrets,
  readAuditPage,
  readAuditRow,
  releaseRotateLease,
  renewRotateLease,
  verifyAuditChain,
  type AuditChainResult,
  type AuditPageOptions,
  type PurgeExpiredResult,
  type SqlExec,
  type VaultAuditRecord,
} from "./storage.ts";
import { createMemoryUnsealer, type Unsealer } from "./unseal.ts";
import type {
  VaultActor,
  VaultAdapter,
  VaultAlgorithm,
  VaultGetOptions,
  VaultInitResult,
  VaultListEntry,
  VaultListOptions,
  VaultSecret,
  VaultSetOptions,
  VaultStatus,
} from "./types.ts";

/** Default number of DEKs re-wrapped per {@link BuiltinVaultAdapter.rotateMaster} batch. */
export const DEFAULT_KEK_REWRAP_BATCH_SIZE = 100;

/** Leading magic line of an {@link BuiltinVaultAdapter.exportBackup} bundle. */
export const BACKUP_MAGIC = "oke-vault-backup-v1\n";

/** Trailing completeness marker — absent means the file was truncated mid-write. */
export const BACKUP_END_MARKER = "oke-vault-backup-end\n";

/** Synthetic path bound into the backup bundle's AAD. */
const BACKUP_AAD_PATH = "oke-vault-backup";

/** Options for {@link createBuiltinVaultAdapter}. */
export interface CreateBuiltinVaultOptions {
  /** SQL surface holding the `oke_vault_*` tables. */
  readonly db: SqlExec;
  /**
   * Pre-built unsealer. When supplied the adapter starts unsealed and
   * {@link VaultAdapter.unseal} is not required.
   */
  readonly unsealer?: Unsealer;
  /** Audit destination. Defaults to a `db` sink over `oke_vault_audit`. */
  readonly auditSink?: AuditSink;
  /** DEKs re-wrapped per rotation batch. Defaults to {@link DEFAULT_KEK_REWRAP_BATCH_SIZE}. */
  readonly kekRewrapBatchSize?: number;
  /**
   * Rotate-master lease TTL in ms (Clock/Signal lazy-reclaim physics).
   * Defaults to {@link DEFAULT_ROTATE_LEASE_MS}.
   */
  readonly rotateLeaseMs?: number;
}

/** Progress of a master-key rotation. */
export interface VaultRotateMasterResult {
  /** KEK generation the rewrap is migrating toward. */
  readonly kekVersion: number;
  /** DEKs still wrapped under an older generation after this batch. */
  readonly remaining: number;
  /**
   * Base64 of a freshly generated master key — present only when
   * {@link BuiltinVaultAdapter.rotateMaster} was called without one, and
   * returned exactly once. Store it out of band before the rewrap finishes.
   */
  readonly masterKey?: string;
}

/** Built-in adapter surface: {@link VaultAdapter} plus operator lifecycle. */
export interface BuiltinVaultAdapter extends VaultAdapter {
  /** Drop the in-memory master key; later reads fail with `SEALED`. */
  seal(): Promise<void>;
  /**
   * Restore the in-memory master key after verifying it against
   * `oke_vault_master.key_hash`.
   *
   * @param masterKey - Base64 text or raw 32 bytes
   */
  unseal(masterKey: string | Uint8Array): Promise<void>;
  /** Generate the master key and persist backend state exactly once. */
  initialize(): Promise<VaultInitResult>;
  /**
   * Start a master-key rotation and re-wrap the first batch of DEKs.
   *
   * Both master keys stay in memory until the rewrap completes, so reads
   * keep working throughout. Call {@link continueRotateMaster} until
   * `remaining` reaches `0`.
   *
   * @param newMasterKey - Raw 32-byte replacement key; generated when omitted
   */
  rotateMaster(newMasterKey?: Uint8Array): Promise<VaultRotateMasterResult>;
  /**
   * Re-wrap the next batch of an in-flight rotation.
   *
   * After a process restart the in-memory pending key is gone — pass the
   * **new** master key (the one printed by {@link rotateMaster}) so the
   * adapter can resume from `rewrap_checkpoint`. The vault must still be
   * unsealed with the **old** master key for dual-read of unrewrapped DEKs.
   *
   * @param newMasterKey - Required after a cold resume; ignored when pending is live
   */
  continueRotateMaster(newMasterKey?: string | Uint8Array): Promise<VaultRotateMasterResult>;
  /**
   * Delete audit rows older than `before`.
   *
   * @param before - Exclusive upper bound on `created_at`
   * @returns Number of rows removed
   */
  purgeAuditBefore(before: Date): Promise<number>;
  /**
   * Hard-delete secret rows with `expires_at` strictly before `before`.
   *
   * @param options - Cutoff and dry-run
   */
  purgeExpired(options?: {
    readonly before?: Date;
    readonly dryRun?: boolean;
  }): Promise<PurgeExpiredResult>;
  /** Walk the audit chain and report the first broken row. */
  verifyAudit(): Promise<AuditChainResult>;
  /**
   * Read the newest audit rows. Never requires an unsealed vault — audit
   * rows describe operations, not values.
   *
   * @param options - Limit / path filter
   */
  listAudit(options?: AuditPageOptions): Promise<readonly VaultAuditRecord[]>;
  /**
   * Load one audit row by id (operator-safe fields).
   *
   * @param id - Audit row id
   */
  readAuditRow(id: string): Promise<VaultAuditRecord | null>;
  /** Export every live secret as one bundle encrypted under the backup KEK. */
  exportBackup(): Promise<Uint8Array>;
  /**
   * Restore a bundle produced by {@link exportBackup}.
   *
   * Entries are replayed through the normal write path: each restored path
   * receives a **new** version wrapped by a fresh DEK under the current KEK.
   *
   * @param blob - Bundle bytes
   */
  importBackup(blob: Uint8Array): Promise<void>;
  /** Active unsealer, or `null` while sealed. */
  getUnsealer(): Unsealer | null;
}

/** Numeric column as any supported driver may hand it back. */
type SqlNumber = number | string | bigint;

/** `oke_vault_secrets` row as returned by the driver. */
interface SecretRow {
  id: string;
  path: string;
  encrypted_value: unknown;
  iv: unknown;
  auth_tag: unknown;
  version: SqlNumber;
  metadata: unknown;
  algorithm: string;
  kek_version: SqlNumber;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string | null;
}

/** `oke_vault_keys` row joined with its secret's AAD inputs. */
interface KeyRow {
  id: string;
  encrypted_dek: unknown;
  dek_iv: unknown;
  dek_auth_tag: unknown;
  kek_version: SqlNumber;
}

/** `oke_vault_status` singleton row. */
interface StatusRow {
  sealed: boolean | number;
  initialized: boolean | number;
  master_key_present: boolean | number;
  last_sealed_at: Date | string | null;
  last_unsealed_at: Date | string | null;
  seal_count: SqlNumber;
  rewrap_checkpoint: string | null;
  rewrap_target_kek_version: SqlNumber | null;
  /** Verify-hash of the pending new master (for cold resume). */
  rewrap_key_hash: string | null;
}

/** `oke_vault_master` row. */
interface MasterRow {
  key_hash: string;
  kek_version: SqlNumber;
}

/** One secret in an export bundle. */
interface BackupEntry {
  readonly path: string;
  readonly value: string;
  readonly version: number;
  readonly metadata: Record<string, unknown>;
  readonly expiresAt: string | null;
}

/** Non-secret header of an export bundle. */
interface BackupMetadata {
  readonly format: 1;
  readonly createdAt: string;
  readonly kekVersion: number;
  readonly count: number;
  readonly iv: string;
  readonly tag: string;
  /** Hex SHA-256 of the ciphertext bytes (completeness check before decrypt). */
  readonly payloadSha256: string;
}

/** Master key held for the target generation of an in-flight rewrap. */
interface PendingRotation {
  readonly unsealer: Unsealer;
  readonly kekVersion: number;
  readonly verifyHash: string;
  /** Lease holder id for SKIP LOCKED rotate exclusivity. */
  readonly holderId: string;
}

/**
 * Create the built-in SQL-backed Vault adapter.
 *
 * The tables are created lazily on first use, so constructing an adapter
 * never touches the database.
 *
 * @param opts - SQL surface, optional unsealer, audit sink, batch size
 */
export function createBuiltinVaultAdapter(opts: CreateBuiltinVaultOptions): BuiltinVaultAdapter {
  // Secret CRUD retries on connection blips. Audit appends stay on the raw
  // surface so a retry never duplicates a hash-chain row.
  const rawDb = opts.db;
  const db = createResilientSqlExec(rawDb);
  const batchSize = Math.max(1, opts.kekRewrapBatchSize ?? DEFAULT_KEK_REWRAP_BATCH_SIZE);
  const rotateLeaseMs = Math.max(50, opts.rotateLeaseMs ?? DEFAULT_ROTATE_LEASE_MS);
  const audit = opts.auditSink ?? createAuditSink("db", { writer: createSqlAuditWriter(rawDb) });

  let unsealer: Unsealer | null = opts.unsealer ?? null;
  let pending: PendingRotation | null = null;
  let ready: Promise<void> | undefined;

  /** Create the `oke_vault_*` tables once per adapter. */
  function ensureReady(): Promise<void> {
    ready ??= ensureVaultTables(db);
    return ready;
  }

  /** Active unsealer, or `SEALED`. */
  function requireUnsealer(): Unsealer {
    if (!unsealer || unsealer.sealed) {
      throw new VaultError("SEALED", "vault: sealed — unseal with the master key first");
    }
    return unsealer;
  }

  /**
   * Append one audit row, tolerating a sink that is temporarily down.
   *
   * An audit failure must not mask the operation's own outcome, so the
   * append error is swallowed after the operation has already succeeded.
   *
   * @param action - What happened
   * @param actor - Caller identity
   * @param extra - Path and failure detail
   */
  async function record(
    action: AuditAction,
    actor: VaultActor | undefined,
    extra: {
      path?: string;
      success?: boolean;
      errorCode?: VaultError["code"];
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    try {
      await audit.append({
        action,
        actorType: actor?.type ?? "unknown",
        ...(actor?.id === undefined ? {} : { actorId: actor.id }),
        ...(actor?.requestId === undefined ? {} : { requestId: actor.requestId }),
        ...(extra.path === undefined ? {} : { path: extra.path }),
        ...(extra.errorCode === undefined ? {} : { errorCode: extra.errorCode }),
        ...(extra.errorMessage === undefined ? {} : { errorMessage: extra.errorMessage }),
        success: extra.success ?? true,
      });
    } catch {
      // Auditing is best-effort at the tail of an operation.
    }
  }

  /** Read the singleton status row, creating the tables when needed. */
  async function readStatus(): Promise<StatusRow> {
    await ensureReady();
    const rows = await db.query<StatusRow>(
      `SELECT sealed, initialized, master_key_present, last_sealed_at, last_unsealed_at,
              seal_count, rewrap_checkpoint, rewrap_target_kek_version, rewrap_key_hash
       FROM oke_vault_status WHERE id = 1`,
    );
    const row = rows[0];
    if (!row) {
      throw new VaultError("BACKEND_ERROR", "vault: status row is missing");
    }
    return row;
  }

  /** Read the master record, or `NOT_INITIALIZED`. */
  async function readMaster(): Promise<MasterRow> {
    await ensureReady();
    const rows = await db.query<MasterRow>(
      `SELECT key_hash, kek_version FROM oke_vault_master ORDER BY created_at ASC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) {
      throw new VaultError("NOT_INITIALIZED", "vault: not initialized — run `oke vault init`");
    }
    return row;
  }

  /**
   * Unwrap a DEK under the active KEK, falling back to a pending rotation's.
   *
   * @param sealed - Stored wrapped-DEK material
   * @param aad - AAD bound at wrap time
   */
  async function unwrapWithAnyKek(sealed: SealedBytes, aad: Uint8Array): Promise<Uint8Array> {
    const keks = [await requireUnsealer().unwrapKek()];
    if (pending) keks.push(await pending.unsealer.unwrapKek());
    for (const kek of keks) {
      try {
        return await unwrapDek(kek, sealed, aad);
      } catch {
        // Try the other generation before giving up.
      }
    }
    throw new VaultError("INVALID_KEY", "vault: unable to unwrap the data key");
  }

  /**
   * Fetch a secret row by path.
   *
   * @param path - Canonical path
   * @param version - Pinned version, or latest when omitted
   */
  async function readSecretRow(path: string, version?: number): Promise<SecretRow | undefined> {
    const rows =
      version === undefined
        ? await db.query<SecretRow>(
            `SELECT id, path, encrypted_value, iv, auth_tag, version, metadata, algorithm,
                    kek_version, created_at, updated_at, expires_at
             FROM oke_vault_secrets
             WHERE path = $1 AND deleted_at IS NULL
             ORDER BY version DESC LIMIT 1`,
            [path],
          )
        : await db.query<SecretRow>(
            `SELECT id, path, encrypted_value, iv, auth_tag, version, metadata, algorithm,
                    kek_version, created_at, updated_at, expires_at
             FROM oke_vault_secrets
             WHERE path = $1 AND version = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [path, version],
          );
    return rows[0];
  }

  /**
   * Fetch the live wrapped DEK for a secret version.
   *
   * @param secretId - `oke_vault_secrets.id`
   */
  async function readKeyRow(secretId: string): Promise<KeyRow> {
    const rows = await db.query<KeyRow>(
      `SELECT id, encrypted_dek, dek_iv, dek_auth_tag, kek_version
       FROM oke_vault_keys WHERE secret_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [secretId],
    );
    const row = rows[0];
    if (!row) {
      throw new VaultError("BACKEND_ERROR", "vault: secret has no wrapped data key");
    }
    return row;
  }

  /**
   * Decrypt one secret row into its cleartext value.
   *
   * @param row - Stored secret version
   * @param keyRow - That version's live wrapped DEK
   */
  async function decryptRow(row: SecretRow, keyRow: KeyRow): Promise<string> {
    const path = row.path;
    const version = toInt(row.version);
    const algorithm = row.algorithm as VaultAlgorithm;

    const dekAad = buildAad(path, version, algorithm, toInt(keyRow.kek_version));
    const dekBytes = await unwrapWithAnyKek(
      {
        iv: toBytes(keyRow.dek_iv),
        ciphertext: toBytes(keyRow.encrypted_dek),
        tag: toBytes(keyRow.dek_auth_tag),
      },
      dekAad,
    );
    try {
      const dek = await importAesKey(dekBytes);
      return await decryptSecret(
        dek,
        {
          iv: toBytes(row.iv),
          ciphertext: toBytes(row.encrypted_value),
          tag: toBytes(row.auth_tag),
        },
        buildAad(path, version, algorithm, toInt(row.kek_version)),
      );
    } finally {
      zeroBytes(dekBytes);
    }
  }

  /**
   * Write a new version of `path` with a fresh DEK.
   *
   * @param path - Canonical path
   * @param value - Cleartext value
   * @param options - Metadata / expiry / actor
   * @param action - Audit action to record (`set` or `rotate`)
   */
  async function writeVersion(
    path: string,
    value: string,
    options: VaultSetOptions | undefined,
    action: Extract<AuditAction, "set" | "rotate">,
  ): Promise<VaultSecret> {
    const master = await readMaster();
    const kekVersion = toInt(master.kek_version);
    const kek = await requireUnsealer().unwrapKek();

    const versions = await db.query<{ next: SqlNumber | null }>(
      `SELECT MAX(version) + 1 AS next FROM oke_vault_secrets WHERE path = $1`,
      [path],
    );
    const version = versions[0]?.next == null ? 1 : toInt(versions[0].next);
    const aad = buildAad(path, version, ALGORITHM, kekVersion);
    const metadata = options?.metadata ?? {};
    const expiresAt = resolveExpiry(options);

    const dekBytes = generateDek();
    let sealedValue: SealedBytes;
    let wrappedDek: SealedBytes;
    try {
      sealedValue = await encryptSecret(await importAesKey(dekBytes), value, aad);
      wrappedDek = await wrapDek(kek, dekBytes, aad);
    } finally {
      zeroBytes(dekBytes);
    }

    const inserted = await db.query<{
      id: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `INSERT INTO oke_vault_secrets
         (path, encrypted_value, iv, auth_tag, version, metadata, algorithm, kek_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING id, created_at, updated_at`,
      [
        path,
        sealedValue.ciphertext,
        sealedValue.iv,
        sealedValue.tag,
        version,
        JSON.stringify(metadata),
        ALGORITHM,
        kekVersion,
        expiresAt ?? null,
      ],
    );
    const row = inserted[0];
    if (!row) {
      throw new VaultError("BACKEND_ERROR", "vault: failed to persist the secret version");
    }

    await db.execute(
      `INSERT INTO oke_vault_keys
         (secret_id, encrypted_dek, dek_iv, dek_auth_tag, algorithm, kek_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, wrappedDek.ciphertext, wrappedDek.iv, wrappedDek.tag, ALGORITHM, kekVersion],
    );

    await record(action, options?.actor, { path });

    return {
      path,
      value,
      version,
      metadata,
      algorithm: ALGORITHM,
      kekVersion,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  /**
   * Re-wrap one batch of DEKs onto the pending KEK generation.
   *
   * @param rotation - In-flight rotation state
   */
  async function rewrapBatch(rotation: PendingRotation): Promise<VaultRotateMasterResult> {
    const target = rotation.kekVersion;
    const nextKek = await rotation.unsealer.unwrapKek();
    const rows = await db.query<KeyRow & { path: string; version: SqlNumber; algorithm: string }>(
      `SELECT k.id, k.encrypted_dek, k.dek_iv, k.dek_auth_tag, k.kek_version,
              s.path, s.version, k.algorithm
       FROM oke_vault_keys k
       JOIN oke_vault_secrets s ON s.id = k.secret_id
       WHERE k.kek_version <> $1
       ORDER BY k.id ASC
       LIMIT $2`,
      [target, batchSize],
    );

    let checkpoint: string | null = null;
    for (const row of rows) {
      const path = row.path;
      const version = toInt(row.version);
      const algorithm = row.algorithm as VaultAlgorithm;
      const dekBytes = await unwrapWithAnyKek(
        {
          iv: toBytes(row.dek_iv),
          ciphertext: toBytes(row.encrypted_dek),
          tag: toBytes(row.dek_auth_tag),
        },
        buildAad(path, version, algorithm, toInt(row.kek_version)),
      );
      try {
        const rewrapped = await wrapDek(
          nextKek,
          dekBytes,
          buildAad(path, version, algorithm, target),
        );
        await db.execute(
          `UPDATE oke_vault_keys
           SET encrypted_dek = $1, dek_iv = $2, dek_auth_tag = $3, kek_version = $4, rotated_at = now()
           WHERE id = $5`,
          [rewrapped.ciphertext, rewrapped.iv, rewrapped.tag, target, row.id],
        );
      } finally {
        zeroBytes(dekBytes);
      }
      checkpoint = row.id;
    }

    const left = await db.query<{ count: SqlNumber }>(
      `SELECT COUNT(*) AS count FROM oke_vault_keys WHERE kek_version <> $1`,
      [target],
    );
    const remaining = toInt(left[0]?.count ?? 0);

    if (remaining === 0) {
      // Commit the new generation: the pending key becomes the only master.
      // Old master is sealed (zeroed) so it leaves process memory.
      await db.execute(
        `UPDATE oke_vault_master SET key_hash = $1, kek_version = $2, updated_at = now()`,
        [rotation.verifyHash, target],
      );
      await db.execute(
        `UPDATE oke_vault_status
         SET rewrap_checkpoint = NULL, rewrap_target_kek_version = NULL,
             rewrap_key_hash = NULL, updated_at = now()
         WHERE id = 1`,
      );
      unsealer?.seal();
      unsealer = rotation.unsealer;
      pending = null;
      await releaseRotateLease(rawDb, rotation.holderId);
    } else {
      await db.execute(
        `UPDATE oke_vault_status
         SET rewrap_checkpoint = $1, rewrap_target_kek_version = $2,
             rewrap_key_hash = $3, updated_at = now()
         WHERE id = 1`,
        [checkpoint, target, rotation.verifyHash],
      );
      await renewRotateLease(rawDb, rotation.holderId, Date.now(), rotateLeaseMs);
    }

    await record("rewrap", undefined, { success: true });
    return { kekVersion: target, remaining };
  }

  const adapter: BuiltinVaultAdapter = {
    id: "vault",

    async initialize(): Promise<VaultInitResult> {
      const status = await readStatus();
      if (toBool(status.initialized)) {
        throw new VaultError("ALREADY_INITIALIZED", "vault: already initialized");
      }

      const masterKey = generateMasterKey();
      try {
        const verifyHash = await deriveVerifyHash(masterKey);
        await db.execute(`INSERT INTO oke_vault_master (key_hash, kek_version) VALUES ($1, 1)`, [
          verifyHash,
        ]);
        await db.execute(
          `UPDATE oke_vault_status
           SET initialized = true, sealed = true, master_key_present = true, updated_at = now()
           WHERE id = 1`,
        );
        await record("initialize", undefined);
        return { masterKey: masterKeyToBase64(masterKey), verifyHash, kekVersion: 1 };
      } finally {
        zeroBytes(masterKey);
      }
    },

    async unseal(masterKey: string | Uint8Array): Promise<void> {
      const master = await readMaster();
      const raw =
        typeof masterKey === "string" ? masterKeyFromBase64(masterKey) : Uint8Array.from(masterKey);
      try {
        const verifyHash = await deriveVerifyHash(raw);
        if (!constantTimeEqualStrings(verifyHash, master.key_hash)) {
          await record("unseal", undefined, {
            success: false,
            errorCode: "INVALID_KEY",
            errorMessage: "vault: master key does not match this vault",
          });
          throw new VaultError("INVALID_KEY", "vault: master key does not match this vault");
        }
        unsealer?.seal();
        unsealer = createMemoryUnsealer(raw);
      } finally {
        zeroBytes(raw);
      }
      await db.execute(
        `UPDATE oke_vault_status
         SET sealed = false, last_unsealed_at = now(), updated_at = now()
         WHERE id = 1`,
      );
      await record("unseal", undefined);
    },

    async seal(): Promise<void> {
      unsealer?.seal();
      unsealer = null;
      pending?.unsealer.seal();
      pending = null;
      await db.execute(
        `UPDATE oke_vault_status
         SET sealed = true, last_sealed_at = now(), seal_count = seal_count + 1, updated_at = now()
         WHERE id = 1`,
      );
      await record("seal", undefined);
    },

    async get(path: string, options?: VaultGetOptions): Promise<VaultSecret | undefined> {
      const canonical = canonicalizePath(path);
      await ensureReady();
      requireUnsealer();

      const row = await readSecretRow(canonical, options?.version);
      if (!row) {
        await record("get", options?.actor, {
          path: canonical,
          success: false,
          errorCode: "SECRET_NOT_FOUND",
          errorMessage: "vault: no such secret",
        });
        return undefined;
      }

      const expiresAt = row.expires_at === null ? undefined : toDate(row.expires_at);
      if (expiresAt && expiresAt.getTime() <= Date.now() && options?.allowExpired !== true) {
        await record("get", options?.actor, {
          path: canonical,
          success: false,
          errorCode: "EXPIRED",
          errorMessage: "vault: secret has expired",
        });
        throw new VaultError("EXPIRED", "vault: secret has expired");
      }

      const keyRow = await readKeyRow(row.id);
      const value = await decryptRow(row, keyRow);
      await record("get", options?.actor, { path: canonical });

      return {
        path: canonical,
        value,
        version: toInt(row.version),
        metadata: toMetadata(row.metadata),
        algorithm: row.algorithm as VaultAlgorithm,
        kekVersion: toInt(keyRow.kek_version),
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        ...(expiresAt ? { expiresAt } : {}),
      };
    },

    async set(path: string, value: string, options?: VaultSetOptions): Promise<VaultSecret> {
      const canonical = canonicalizePath(path);
      await ensureReady();
      requireUnsealer();
      return writeVersion(canonical, value, options, "set");
    },

    async rotate(path: string, value: string, options?: VaultSetOptions): Promise<VaultSecret> {
      const canonical = canonicalizePath(path);
      await ensureReady();
      requireUnsealer();
      return writeVersion(canonical, value, options, "rotate");
    },

    async delete(path: string, options?: { readonly actor?: VaultActor }): Promise<boolean> {
      const canonical = canonicalizePath(path);
      await ensureReady();
      requireUnsealer();
      const rows = await db.query<{ id: string }>(
        `UPDATE oke_vault_secrets SET deleted_at = now(), updated_at = now()
         WHERE path = $1 AND deleted_at IS NULL
         RETURNING id`,
        [canonical],
      );
      await record("delete", options?.actor, { path: canonical, success: rows.length > 0 });
      return rows.length > 0;
    },

    async list(options?: VaultListOptions): Promise<readonly VaultListEntry[]> {
      await ensureReady();
      const prefix = canonicalizePrefix(options?.prefix);
      const filters: string[] = [];
      const params: unknown[] = [];
      if (options?.includeDeleted !== true) filters.push("deleted_at IS NULL");
      if (prefix !== undefined) {
        params.push(prefix);
        filters.push(`(path = $${params.length} OR path LIKE $${params.length} || '/%')`);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      let limit = "";
      if (options?.limit !== undefined && options.limit > 0) {
        params.push(Math.floor(options.limit));
        limit = `LIMIT $${params.length}`;
      }

      const rows = await db.query<{
        path: string;
        version: SqlNumber;
        updated_at: Date | string;
        expires_at: Date | string | null;
      }>(
        `SELECT DISTINCT ON (path) path, version, updated_at, expires_at
         FROM oke_vault_secrets ${where}
         ORDER BY path ASC, version DESC ${limit}`,
        params,
      );

      await record("list", options?.actor);
      return rows.map((row) => ({
        path: row.path,
        version: toInt(row.version),
        updatedAt: toDate(row.updated_at),
        ...(row.expires_at === null ? {} : { expiresAt: toDate(row.expires_at) }),
      }));
    },

    async status(): Promise<VaultStatus> {
      const status = await readStatus();
      const master = await db.query<MasterRow>(
        `SELECT key_hash, kek_version FROM oke_vault_master ORDER BY created_at ASC LIMIT 1`,
      );
      const counted = await db.query<{ count: SqlNumber }>(
        `SELECT COUNT(DISTINCT path) AS count FROM oke_vault_secrets WHERE deleted_at IS NULL`,
      );
      const target = status.rewrap_target_kek_version;
      return {
        sealed: unsealer === null || unsealer.sealed,
        initialized: toBool(status.initialized),
        masterKeyPresent: master.length > 0,
        kekVersion: toInt(master[0]?.kek_version ?? 1),
        secretCount: toInt(counted[0]?.count ?? 0),
        sealCount: toInt(status.seal_count),
        ...(status.last_sealed_at === null ? {} : { lastSealedAt: toDate(status.last_sealed_at) }),
        ...(status.last_unsealed_at === null
          ? {}
          : { lastUnsealedAt: toDate(status.last_unsealed_at) }),
        ...(status.rewrap_checkpoint === null
          ? {}
          : { rewrapCheckpoint: status.rewrap_checkpoint }),
        ...(target === null ? {} : { rewrapTargetKekVersion: toInt(target) }),
      };
    },

    async rotateMaster(newMasterKey?: Uint8Array): Promise<VaultRotateMasterResult> {
      await ensureReady();
      requireUnsealer();
      if (pending) {
        throw new VaultError("UNSUPPORTED", "vault: a master rotation is already in progress");
      }

      const holderId = crypto.randomUUID();
      const now = Date.now();
      const won = await acquireRotateLease(rawDb, holderId, now, rotateLeaseMs);
      if (!won) {
        throw new VaultError(
          "UNSUPPORTED",
          "vault: master rotation lease held by another instance",
        );
      }

      try {
        const status = await readStatus();
        if (status.rewrap_target_kek_version !== null) {
          throw new VaultError("UNSUPPORTED", "vault: a master rotation is already in progress");
        }

        const master = await readMaster();
        const target = toInt(master.kek_version) + 1;

        const generated = newMasterKey === undefined;
        const raw = newMasterKey ?? generateMasterKey();
        let rotation: PendingRotation;
        let encoded: string | undefined;
        try {
          rotation = {
            unsealer: createMemoryUnsealer(raw),
            kekVersion: target,
            verifyHash: await deriveVerifyHash(raw),
            holderId,
          };
          if (generated) encoded = masterKeyToBase64(raw);
        } finally {
          if (generated) zeroBytes(raw);
        }
        pending = rotation;

        await db.execute(
          `UPDATE oke_vault_status
           SET rewrap_target_kek_version = $1, rewrap_checkpoint = NULL,
               rewrap_key_hash = $2, updated_at = now()
           WHERE id = 1`,
          [target, rotation.verifyHash],
        );
        const result = await rewrapBatch(rotation);
        return encoded === undefined ? result : { ...result, masterKey: encoded };
      } catch (error) {
        // No persisted rewrap yet → release so a peer can retry immediately.
        if (pending === null) {
          await releaseRotateLease(rawDb, holderId).catch(() => undefined);
        } else {
          const status = await readStatus().catch(() => null);
          if (status?.rewrap_target_kek_version === null) {
            pending = null;
            await releaseRotateLease(rawDb, holderId).catch(() => undefined);
          }
        }
        throw error;
      }
    },

    async continueRotateMaster(
      newMasterKey?: string | Uint8Array,
    ): Promise<VaultRotateMasterResult> {
      await ensureReady();
      requireUnsealer();
      let rotation = pending;
      if (!rotation) {
        // Cold resume after process death: rebuild pending from the new key
        // the operator saved when rotateMaster printed it.
        const status = await readStatus();
        const target = status.rewrap_target_kek_version;
        const expectedHash = status.rewrap_key_hash;
        if (target === null || expectedHash === null || expectedHash.length === 0) {
          throw new VaultError("UNSUPPORTED", "vault: no master rotation is in progress");
        }
        if (newMasterKey === undefined) {
          throw new VaultError(
            "INVALID_KEY",
            "vault: resume rotate-master with the new master key (--new-key / OKE_VAULT_NEW_MASTER_KEY)",
          );
        }
        const holderId = crypto.randomUUID();
        const won = await acquireRotateLease(rawDb, holderId, Date.now(), rotateLeaseMs);
        if (!won) {
          throw new VaultError(
            "UNSUPPORTED",
            "vault: master rotation lease held by another instance",
          );
        }
        const raw =
          typeof newMasterKey === "string"
            ? masterKeyFromBase64(newMasterKey)
            : new Uint8Array(newMasterKey);
        try {
          const hash = await deriveVerifyHash(raw);
          if (!constantTimeEqualStrings(hash, expectedHash)) {
            await releaseRotateLease(rawDb, holderId).catch(() => undefined);
            throw new VaultError(
              "INVALID_KEY",
              "vault: new master key does not match in-flight rotation",
            );
          }
          rotation = {
            unsealer: createMemoryUnsealer(raw),
            kekVersion: toInt(target),
            verifyHash: hash,
            holderId,
          };
          pending = rotation;
        } finally {
          zeroBytes(raw);
        }
      } else {
        const won = await renewRotateLease(rawDb, rotation.holderId, Date.now(), rotateLeaseMs);
        if (!won) {
          throw new VaultError(
            "UNSUPPORTED",
            "vault: master rotation lease held by another instance",
          );
        }
      }
      return rewrapBatch(rotation);
    },

    async purgeAuditBefore(before: Date): Promise<number> {
      await ensureReady();
      const removed = await purgeAuditRows(db, before);
      await record("purge", undefined);
      return removed;
    },

    async purgeExpired(options?: {
      readonly before?: Date;
      readonly dryRun?: boolean;
    }): Promise<PurgeExpiredResult> {
      await ensureReady();
      requireUnsealer();
      const before = options?.before ?? new Date();
      const dryRun = options?.dryRun === true;
      const result = await purgeExpiredSecrets(db, before, dryRun);
      if (!dryRun) {
        await record("purge", undefined, {
          success: true,
          errorMessage: `expired count=${result.count}`,
        });
      }
      return result;
    },

    async verifyAudit(): Promise<AuditChainResult> {
      await ensureReady();
      return verifyAuditChain(db);
    },

    async listAudit(options?: AuditPageOptions): Promise<readonly VaultAuditRecord[]> {
      await ensureReady();
      return readAuditPage(db, options ?? {});
    },

    async readAuditRow(id: string): Promise<VaultAuditRecord | null> {
      await ensureReady();
      return readAuditRow(db, id);
    },

    async exportBackup(): Promise<Uint8Array> {
      await ensureReady();
      const active = requireUnsealer();
      const master = await readMaster();
      const kekVersion = toInt(master.kek_version);

      const rows = await db.query<SecretRow>(
        `SELECT DISTINCT ON (path) id, path, encrypted_value, iv, auth_tag, version, metadata,
                algorithm, kek_version, created_at, updated_at, expires_at
         FROM oke_vault_secrets WHERE deleted_at IS NULL
         ORDER BY path ASC, version DESC`,
      );
      const entries: BackupEntry[] = [];
      for (const row of rows) {
        entries.push({
          path: row.path,
          value: await decryptRow(row, await readKeyRow(row.id)),
          version: toInt(row.version),
          metadata: toMetadata(row.metadata),
          expiresAt: row.expires_at === null ? null : toDate(row.expires_at).toISOString(),
        });
      }

      const payload = new TextEncoder().encode(JSON.stringify(entries));
      let sealed: SealedBytes;
      try {
        sealed = await encryptBytes(
          await active.unwrapBackupKek(),
          payload,
          buildAad(BACKUP_AAD_PATH, 1, ALGORITHM, kekVersion),
        );
      } finally {
        zeroBytes(payload);
      }

      const payloadSha256 = await sha256Hex(sealed.ciphertext);
      const metadata: BackupMetadata = {
        format: 1,
        createdAt: new Date().toISOString(),
        kekVersion,
        count: entries.length,
        iv: toBase64(sealed.iv),
        tag: toBase64(sealed.tag),
        payloadSha256,
      };
      const header = new TextEncoder().encode(`${BACKUP_MAGIC}${JSON.stringify(metadata)}\n`);
      const end = new TextEncoder().encode(BACKUP_END_MARKER);
      const blob = new Uint8Array(
        header.byteLength + sealed.ciphertext.byteLength + end.byteLength,
      );
      blob.set(header, 0);
      blob.set(sealed.ciphertext, header.byteLength);
      blob.set(end, header.byteLength + sealed.ciphertext.byteLength);
      return blob;
    },

    async importBackup(blob: Uint8Array): Promise<void> {
      await ensureReady();
      const active = requireUnsealer();
      const textHead = new TextDecoder().decode(blob.subarray(0, Math.min(blob.byteLength, 8192)));
      if (!textHead.startsWith(BACKUP_MAGIC)) {
        throw new VaultError("UNSUPPORTED", "vault: not an oke vault backup bundle");
      }

      const endBytes = new TextEncoder().encode(BACKUP_END_MARKER);
      if (blob.byteLength < endBytes.byteLength || !tailEquals(blob, endBytes)) {
        throw new VaultError(
          "UNSUPPORTED",
          "vault: backup bundle is incomplete (missing end marker)",
        );
      }
      const body = blob.subarray(0, blob.byteLength - endBytes.byteLength);

      const headerEnd = textHead.indexOf("\n", BACKUP_MAGIC.length);
      if (headerEnd < 0) {
        throw new VaultError("UNSUPPORTED", "vault: backup bundle header is truncated");
      }

      let metadata: BackupMetadata;
      try {
        metadata = JSON.parse(textHead.slice(BACKUP_MAGIC.length, headerEnd)) as BackupMetadata;
      } catch {
        throw new VaultError("UNSUPPORTED", "vault: backup bundle header is not valid JSON");
      }

      const offset = new TextEncoder().encode(textHead.slice(0, headerEnd + 1)).byteLength;
      const ciphertext = body.subarray(offset);
      if (
        typeof metadata.payloadSha256 !== "string" ||
        metadata.payloadSha256.length === 0 ||
        !constantTimeEqualStrings(metadata.payloadSha256, await sha256Hex(ciphertext))
      ) {
        throw new VaultError(
          "UNSUPPORTED",
          "vault: backup bundle checksum mismatch (truncated or corrupt)",
        );
      }

      const plain = await decryptBytes(
        await active.unwrapBackupKek(),
        {
          iv: fromBase64(metadata.iv),
          ciphertext,
          tag: fromBase64(metadata.tag),
        },
        buildAad(BACKUP_AAD_PATH, 1, ALGORITHM, metadata.kekVersion),
      );

      let entries: readonly BackupEntry[];
      try {
        entries = JSON.parse(new TextDecoder().decode(plain)) as readonly BackupEntry[];
      } catch {
        throw new VaultError("UNSUPPORTED", "vault: backup payload is not valid JSON");
      } finally {
        zeroBytes(plain);
      }

      for (const entry of entries) {
        await writeVersion(
          canonicalizePath(entry.path),
          entry.value,
          {
            metadata: entry.metadata,
            ...(entry.expiresAt === null ? {} : { expiresAt: new Date(entry.expiresAt) }),
          },
          "set",
        );
      }
    },

    getUnsealer(): Unsealer | null {
      return unsealer;
    },
  };

  return adapter;
}

/**
 * Adapt a driver {@link import("../../drivers/types.ts").SqlConnection}-shaped
 * object to the {@link SqlExec} surface the Vault needs.
 *
 * Accepts either `exec` (the driver contract) or `execute`, so a thin custom
 * wrapper works without a shim. Always exposes {@link SqlExec.begin} so
 * rotate-master leases (`FOR UPDATE SKIP LOCKED`) and audit appends
 * (`FOR UPDATE`) serialize — in-process via a mutex, and on real SQL via
 * `BEGIN`/`COMMIT` when the driver is not the memory fake.
 *
 * @param conn - Connection exposing `query` plus `exec` or `execute`
 */
export function sqlConnectionAsExec(conn: {
  query(sql: string, params?: readonly unknown[]): Promise<unknown[]>;
  exec?(sql: string, params?: readonly unknown[]): Promise<unknown>;
  execute?(sql: string, params?: readonly unknown[]): Promise<void>;
  driverId?: string;
}): SqlExec {
  let gate: Promise<unknown> = Promise.resolve();

  async function runQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return (await conn.query(sql, params ?? [])) as T[];
  }

  async function runExecute(sql: string, params?: unknown[]): Promise<void> {
    if (conn.exec) {
      await conn.exec(sql, params ?? []);
      return;
    }
    if (conn.execute) {
      await conn.execute(sql, params ?? []);
      return;
    }
    await conn.query(sql, params ?? []);
  }

  const surface: SqlExec = {
    query: runQuery,
    execute: runExecute,
    begin<T>(fn: (tx: SqlExec) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        const useSqlTx = conn.driverId !== "memory";
        if (useSqlTx) await runExecute("BEGIN");
        try {
          // Nested work shares this connection; the gate serializes begin() callers.
          const result = await fn({
            query: runQuery,
            execute: runExecute,
          });
          if (useSqlTx) await runExecute("COMMIT");
          return result;
        } catch (error) {
          if (useSqlTx) await runExecute("ROLLBACK").catch(() => undefined);
          throw error;
        }
      };
      const next = gate.then(run, run);
      gate = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  return surface;
}

/**
 * Write a vault backup bundle atomically: temp file → fsync → rename.
 *
 * Prevents a crash mid-write from leaving a magic-prefixed partial file at
 * the final path that an operator could mistake for a complete backup.
 *
 * @param path - Final destination path
 * @param blob - Complete bundle bytes (including end marker)
 */
export async function writeBackupFileAtomic(path: string, blob: Uint8Array): Promise<void> {
  const { open, rename, unlink } = await import("node:fs/promises");
  const tmp = `${path}.oke-tmp-${process.pid}-${Date.now()}`;
  try {
    await Bun.write(tmp, blob);
    const fh = await open(tmp, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Hex-encode a SHA-256 digest of `bytes`.
 *
 * @param bytes - Payload to hash
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Buffer.from(digest).toString("hex");
}

/**
 * Copy into a real `ArrayBuffer` for Web Crypto `BufferSource` typing.
 *
 * @param view - Source bytes (may be backed by `ArrayBufferLike`)
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/**
 * Whether `blob` ends exactly with `tail`.
 *
 * @param blob - Full buffer
 * @param tail - Expected suffix
 */
function tailEquals(blob: Uint8Array, tail: Uint8Array): boolean {
  if (blob.byteLength < tail.byteLength) return false;
  const start = blob.byteLength - tail.byteLength;
  for (let i = 0; i < tail.byteLength; i += 1) {
    if (blob[start + i] !== tail[i]) return false;
  }
  return true;
}

/**
 * Resolve the absolute expiry for a write.
 *
 * @param options - Write options carrying `expiresAt` or `ttlMs`
 */
function resolveExpiry(options: VaultSetOptions | undefined): Date | undefined {
  if (options?.expiresAt) return options.expiresAt;
  if (options?.ttlMs !== undefined && options.ttlMs > 0) {
    return new Date(Date.now() + options.ttlMs);
  }
  return undefined;
}

/**
 * Normalize a `bytea` column to bytes.
 *
 * Drivers return `Uint8Array`, a Node `Buffer`, or Postgres hex text
 * (`\x0a1b…`) depending on the transport.
 *
 * @param value - Raw column value
 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") {
    return new Uint8Array(
      value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "base64"),
    );
  }
  throw new VaultError("BACKEND_ERROR", "vault: unexpected binary column encoding");
}

/**
 * Normalize a numeric column (drivers may return `bigint` counts as text).
 *
 * @param value - Raw column value
 */
function toInt(value: SqlNumber): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Normalize a boolean column.
 *
 * @param value - Raw column value
 */
function toBool(value: boolean | number): boolean {
  return value === true || value === 1;
}

/**
 * Normalize a timestamp column to a `Date`.
 *
 * @param value - Raw column value
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Normalize a `jsonb` column to a plain object.
 *
 * @param value - Raw column value
 */
function toMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

/**
 * Base64-encode bytes for a backup header.
 *
 * @param bytes - Buffer to encode
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Decode base64 from a backup header.
 *
 * @param text - Base64 text
 */
function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}
