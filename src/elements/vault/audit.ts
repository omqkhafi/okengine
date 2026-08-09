/**
 * Vault audit trail — a tamper-evident hash chain of *operations*.
 *
 * An audit row records that something happened to a path, never what the
 * value was. Each row hashes its own payload together with the previous
 * row's hash, so removing or editing a row breaks every hash after it
 * (`verifyAuditChain` in `storage.ts` walks the chain).
 */

import { VaultError } from "./errors.ts";
import type { VaultErrorCode } from "./errors.ts";
import type { VaultActorType } from "./types.ts";
import type { VaultAuditSinkKind } from "./types.ts";

/** Operations recorded in the audit chain. */
export type AuditAction =
  | "get"
  | "set"
  | "delete"
  | "rotate"
  | "list"
  | "seal"
  | "unseal"
  | "initialize"
  | "rewrap"
  | "purge";

/** Hash-chain genesis marker used for the first row. */
export const AUDIT_GENESIS_HASH = "genesis";

/** One operation to append to the chain. */
export interface AuditEntry {
  /** What happened. */
  readonly action: AuditAction;
  /** Canonical path, when the operation targets one. */
  readonly path?: string;
  /** Actor class. */
  readonly actorType: VaultActorType;
  /** Actor id within its class. */
  readonly actorId?: string;
  /** Whether the operation succeeded. */
  readonly success: boolean;
  /** Failure reason when `success` is `false`. */
  readonly errorCode?: VaultErrorCode;
  /** Safe, secret-free failure description. */
  readonly errorMessage?: string;
  /** Correlation id for the enclosing request/run. */
  readonly requestId?: string;
  /** Event time. Defaults to now at append time. */
  readonly at?: Date;
}

/**
 * Exact field set covered by a row hash.
 *
 * Normalized (`null` rather than `undefined`, ISO-8601 timestamps) so a row
 * read back from SQL hashes identically to the row that was written.
 */
export interface AuditHashPayload {
  /** What happened. */
  readonly action: AuditAction;
  /** Canonical path or `null`. */
  readonly path: string | null;
  /** Actor class. */
  readonly actorType: VaultActorType;
  /** Actor id or `null`. */
  readonly actorId: string | null;
  /** Whether the operation succeeded. */
  readonly success: boolean;
  /** Failure reason or `null`. */
  readonly errorCode: VaultErrorCode | null;
  /** Failure description or `null`. */
  readonly errorMessage: string | null;
  /** Correlation id or `null`. */
  readonly requestId: string | null;
  /** ISO-8601 event time. */
  readonly createdAt: string;
}

/** Destination for audit rows. */
export interface AuditSink {
  /** Sink kind, mirroring the configured `audit.sink`. */
  readonly kind: VaultAuditSinkKind;
  /**
   * Append one operation.
   *
   * @param entry - Operation to record
   */
  append(entry: AuditEntry): Promise<void>;
  /** Release sink resources, if any. */
  close?(): Promise<void>;
}

/**
 * Backend-side audit writer.
 *
 * `storage.ts` implements this over `oke_vault_audit`; the `db` sink is a
 * thin adapter so the audit module never imports SQL.
 */
export interface AuditWriter {
  /**
   * Persist one operation, computing and linking its row hash.
   *
   * @param entry - Operation to record
   */
  appendAuditEntry(entry: AuditEntry): Promise<void>;
}

/** Options accepted by {@link createAuditSink}. */
export interface CreateAuditSinkOptions {
  /** Required for the `db` sink. */
  readonly writer?: AuditWriter;
  /** Required for the `webhook` sink (not yet implemented). */
  readonly webhookUrl?: string;
  /** Line writer for the `stdout` sink (tests). */
  readonly write?: (line: string) => void;
  /** Clock for `stdout` timestamps (tests). */
  readonly now?: () => Date;
}

/**
 * Normalize an entry into the exact fields a row hash covers.
 *
 * @param entry - Operation to record
 * @param createdAt - Event time
 */
export function toAuditHashPayload(entry: AuditEntry, createdAt: Date): AuditHashPayload {
  return {
    action: entry.action,
    path: entry.path ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    success: entry.success,
    errorCode: entry.errorCode ?? null,
    errorMessage: entry.errorMessage ?? null,
    requestId: entry.requestId ?? null,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Hash one audit row into the chain.
 *
 * Fields are joined with NUL in a fixed order — no JSON key-order or
 * whitespace ambiguity — and prefixed with the previous row's hash.
 *
 * @param prevHash - Previous row hash, or `null` / {@link AUDIT_GENESIS_HASH} for the first row
 * @param payload - Normalized row fields
 * @returns Lowercase hex SHA-256 digest
 */
export async function computeAuditRowHash(
  prevHash: string | null,
  payload: AuditHashPayload,
): Promise<string> {
  const parts = [
    "oke-vault-audit-v1",
    prevHash ?? AUDIT_GENESIS_HASH,
    payload.action,
    payload.path ?? "",
    payload.actorType,
    payload.actorId ?? "",
    payload.success ? "1" : "0",
    payload.errorCode ?? "",
    payload.errorMessage ?? "",
    payload.requestId ?? "",
    payload.createdAt,
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\0")));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

/**
 * Build an audit sink.
 *
 * - `db` delegates to an {@link AuditWriter} supplied by storage.
 * - `stdout` writes one secret-free JSON line per operation.
 * - `webhook` is not implemented yet and throws `UNSUPPORTED`.
 *
 * @param kind - Sink kind from `audit.sink`
 * @param opts - Writer / webhook URL / test seams
 * @throws VaultError `UNSUPPORTED` for `webhook`, or `MISSING_PEER` when `db` has no writer
 */
export function createAuditSink(
  kind: VaultAuditSinkKind,
  opts: CreateAuditSinkOptions = {},
): AuditSink {
  if (kind === "webhook") {
    throw new VaultError("UNSUPPORTED", "vault: webhook audit sink is not implemented");
  }

  if (kind === "db") {
    const writer = opts.writer;
    if (!writer) {
      throw new VaultError("MISSING_PEER", "vault: db audit sink requires a storage writer");
    }
    return {
      kind: "db",
      append(entry) {
        return writer.appendAuditEntry(entry);
      },
    };
  }

  const write = opts.write ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());
  return {
    kind: "stdout",
    async append(entry) {
      // Only normalized metadata is serialized — an entry never holds a value.
      write(
        JSON.stringify({
          sink: "oke.vault.audit",
          ...toAuditHashPayload(entry, entry.at ?? now()),
        }),
      );
    },
  };
}

/**
 * Sink that drops every entry (`audit.enabled: false`).
 *
 * Reports `kind: "stdout"` because {@link VaultAuditSinkKind} has no
 * "off" member — callers gate on config, not on this field.
 */
export function createNullAuditSink(): AuditSink {
  return {
    kind: "stdout",
    async append() {
      // Intentionally empty — auditing is disabled.
    },
  };
}
