/**
 * Vault value/adapter/config shapes shared by every backend.
 *
 * These types describe the *encrypted-at-rest* Vault (secrets stored by
 * path, wrapped by a KEK derived from a master key) — distinct from the
 * boot-time contract declarations in `declare.ts`.
 */

import type { VaultErrorCode } from "./errors.ts";

/** Content-encryption algorithm identifier persisted alongside every row. */
export type VaultAlgorithm = "aes-256-gcm";

/** Who performed a Vault operation (audit + policy). */
export type VaultActorType = "flow" | "operator" | "system" | "cli" | "unknown";

/** Caller identity attached to a mutation for audit purposes. */
export interface VaultActor {
  /** Actor class. */
  readonly type: VaultActorType;
  /** Stable id within the actor class (flow name, operator id, …). */
  readonly id?: string;
  /** Correlation id for the enclosing request/run. */
  readonly requestId?: string;
}

/** A decrypted secret as returned to a caller. */
export interface VaultSecret {
  /** Canonical path (`prod/api/stripe`). */
  readonly path: string;
  /** Cleartext value — never log, never serialize. */
  readonly value: string;
  /** Monotonic version, starting at 1. */
  readonly version: number;
  /** Non-sensitive metadata stored beside the ciphertext. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Algorithm used for this version. */
  readonly algorithm: VaultAlgorithm;
  /** KEK generation that wrapped this version's DEK. */
  readonly kekVersion: number;
  /** First-write timestamp for the path. */
  readonly createdAt: Date;
  /** Last-write timestamp for this version. */
  readonly updatedAt: Date;
  /** Absolute expiry; reads past it fail with `EXPIRED`. */
  readonly expiresAt?: Date;
}

/** Options for {@link VaultAdapter.set} / {@link VaultAdapter.rotate}. */
export interface VaultSetOptions {
  /** Non-sensitive metadata stored beside the ciphertext. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Absolute expiry. Takes precedence over {@link ttlMs}. */
  readonly expiresAt?: Date;
  /** Relative expiry from now, in milliseconds. */
  readonly ttlMs?: number;
  /** Caller identity recorded in the audit chain. */
  readonly actor?: VaultActor;
}

/** Options for read-side operations. */
export interface VaultGetOptions {
  /** Read a specific version instead of the latest. */
  readonly version?: number;
  /** Return expired secrets instead of failing with `EXPIRED`. */
  readonly allowExpired?: boolean;
  /** Caller identity recorded in the audit chain. */
  readonly actor?: VaultActor;
}

/** One entry in a {@link VaultAdapter.list} result (never a value). */
export interface VaultListEntry {
  /** Canonical path. */
  readonly path: string;
  /** Latest version for the path. */
  readonly version: number;
  /** Last-write timestamp. */
  readonly updatedAt: Date;
  /** Absolute expiry, when set. */
  readonly expiresAt?: Date;
}

/** Options for {@link VaultAdapter.list}. */
export interface VaultListOptions {
  /** Canonical path prefix filter (`prod/api`). */
  readonly prefix?: string;
  /** Maximum entries to return. */
  readonly limit?: number;
  /** Include soft-deleted paths. */
  readonly includeDeleted?: boolean;
  /** Caller identity recorded in the audit chain. */
  readonly actor?: VaultActor;
}

/** Operational state of a Vault backend. */
export interface VaultStatus {
  /** Whether the master key is currently unavailable in memory. */
  readonly sealed: boolean;
  /** Whether {@link VaultAdapter.initialize} has run. */
  readonly initialized: boolean;
  /** Whether a master-key record exists in the backend. */
  readonly masterKeyPresent: boolean;
  /** Current KEK generation new writes use. */
  readonly kekVersion: number;
  /** Number of live (non-deleted) paths. */
  readonly secretCount: number;
  /** Last transition into sealed state. */
  readonly lastSealedAt?: Date;
  /** Last transition out of sealed state. */
  readonly lastUnsealedAt?: Date;
  /** How many times the Vault has been sealed since initialization. */
  readonly sealCount: number;
  /** Resume cursor for an in-flight KEK rewrap. */
  readonly rewrapCheckpoint?: string;
  /** KEK generation an in-flight rewrap is migrating toward. */
  readonly rewrapTargetKekVersion?: number;
}

/** Result of a one-time {@link VaultAdapter.initialize}. */
export interface VaultInitResult {
  /**
   * Base64 master key — returned exactly once, never persisted in cleartext.
   * The operator is responsible for storing it out of band.
   */
  readonly masterKey: string;
  /** Verification hash persisted so later unseals can reject a wrong key. */
  readonly verifyHash: string;
  /** KEK generation the Vault starts at. */
  readonly kekVersion: number;
}

/**
 * Backend-agnostic Vault surface.
 *
 * `seal` / `unseal` / `initialize` are optional: pass-through backends
 * (managed KMS, remote providers) own their own key lifecycle.
 */
export interface VaultAdapter {
  /** Backend id (`sql`, `memory`, `vault`, …). */
  readonly id: string;
  /**
   * Read the latest (or pinned) version of a path.
   *
   * @param path - Canonical path
   * @param options - Version pin / expiry policy / actor
   */
  get(path: string, options?: VaultGetOptions): Promise<VaultSecret | undefined>;
  /**
   * Write a new version of a path (creates it when absent).
   *
   * @param path - Canonical path
   * @param value - Cleartext value
   * @param options - Metadata / expiry / actor
   */
  set(path: string, value: string, options?: VaultSetOptions): Promise<VaultSecret>;
  /**
   * Crypto-shred a path. Returns whether anything was removed.
   *
   * @param path - Canonical path
   * @param options - Actor
   */
  delete(path: string, options?: { readonly actor?: VaultActor }): Promise<boolean>;
  /**
   * Write a new version with a fresh DEK, retiring the previous one.
   *
   * @param path - Canonical path
   * @param value - New cleartext value
   * @param options - Metadata / expiry / actor
   */
  rotate(path: string, value: string, options?: VaultSetOptions): Promise<VaultSecret>;
  /**
   * Enumerate paths (never values).
   *
   * @param options - Prefix / limit / actor
   */
  list(options?: VaultListOptions): Promise<readonly VaultListEntry[]>;
  /** Operational state for Console and health checks. */
  status(): Promise<VaultStatus>;
  /** Drop the in-memory master key; subsequent reads fail with `SEALED`. */
  seal?(): Promise<void>;
  /**
   * Restore the in-memory master key.
   *
   * @param masterKey - Base64 or raw 32-byte master key
   */
  unseal?(masterKey: string | Uint8Array): Promise<void>;
  /** Generate the master key and persist backend state exactly once. */
  initialize?(): Promise<VaultInitResult>;
}

/** Where the master key comes from at boot. */
export type MasterKeySource =
  | {
      /** Read a base64 master key from an environment variable. */
      readonly kind: "env";
      /** Variable name (e.g. `OKE_VAULT_MASTER_KEY`). */
      readonly name: string;
    }
  | {
      /** Read a raw 32-byte or base64 master key from disk. */
      readonly kind: "file";
      /** Absolute or project-relative file path. */
      readonly path: string;
    }
  | {
      /** Unwrap the master key through an external KMS. */
      readonly kind: "kms";
      /** Provider-specific key identifier. */
      readonly keyId: string;
      /** Provider id (`aws`, `gcp`, …). */
      readonly provider?: string;
    }
  | {
      /** Hold the master key in process memory only (tests / dev). */
      readonly kind: "memory";
    };

/** Encryption block of {@link VaultElementConfig}. */
export interface VaultEncryptionConfig {
  /** Content-encryption algorithm. Defaults to `aes-256-gcm`. */
  readonly algorithm?: VaultAlgorithm;
  /** Master-key provider. Defaults to `{ kind: "env", name: "OKE_VAULT_MASTER_KEY" }`. */
  readonly masterKey?: MasterKeySource;
  /** KEK generation new writes use. Defaults to `1`. */
  readonly kekVersion?: number;
  /**
   * Rows re-wrapped per transaction during a KEK rotation. Bounded so a
   * rewrap never holds a long transaction open. Defaults to `100`.
   */
  readonly kekRewrapBatchSize?: number;
}

/** Where audit rows are written. */
export type VaultAuditSinkKind = "db" | "stdout" | "webhook";

/** Audit block of {@link VaultElementConfig}. */
export interface VaultAuditConfig {
  /** Whether auditing is on. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Sink kind. Defaults to `db`. */
  readonly sink?: VaultAuditSinkKind;
  /** Destination for the `webhook` sink. */
  readonly webhookUrl?: string;
  /** Days of audit history to keep; older rows are purgeable. */
  readonly retainDays?: number;
  /** Whether each row links to its predecessor by hash. Defaults to `true`. */
  readonly hashChain?: boolean;
}

/** Seal block of {@link VaultElementConfig}. */
export interface VaultSealConfig {
  /** Auto-seal after this many idle milliseconds. `0` disables. */
  readonly autoSealAfterMs?: number;
  /** Start sealed and require an explicit unseal. Defaults to `false`. */
  readonly sealOnBoot?: boolean;
  /** Reject reads while sealed rather than lazily unsealing. Defaults to `true`. */
  readonly requireUnsealForRead?: boolean;
}

/** Managed (hosted) backend block of {@link VaultElementConfig}. */
export interface VaultManagedConfig {
  /** Whether the managed backend is used instead of local SQL. */
  readonly enabled?: boolean;
  /** Managed service endpoint. */
  readonly endpoint?: string;
  /** Tenant / namespace within the managed service. */
  readonly namespace?: string;
}

/** Manifest-facing `vault` element configuration. */
export interface VaultElementConfig {
  /** Algorithm + master-key + KEK settings. */
  readonly encryption?: VaultEncryptionConfig;
  /** Audit sink + retention settings. */
  readonly audit?: VaultAuditConfig;
  /** Seal lifecycle settings. */
  readonly seal?: VaultSealConfig;
  /** Managed backend settings. */
  readonly managed?: VaultManagedConfig;
}

/** Failure detail surfaced to Console without leaking material. */
export interface VaultFailure {
  /** Machine-readable reason. */
  readonly code: VaultErrorCode;
  /** Safe, secret-free description. */
  readonly message: string;
}
