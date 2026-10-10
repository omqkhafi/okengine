/**
 * Per-call human confirmation for sensitive / irreversible MCP actions.
 *
 * console §10.3: no session-level consent caching. Approving once and never
 * re-validating is how tool poisoning and rug pulls persist. Every write
 * (or otherwise sensitive) tool invocation must carry a fresh confirmation
 * token that was issued for that exact tool + arguments digest.
 *
 * The requester and the issuer are different auth sessions (`claims.sid`),
 * even when they are the same principal. A write without a token returns an
 * opaque confirmation id bound to the requester. `oke.action.confirm` mints
 * the token only from another session. Only the requester session can
 * consume it, and the issuer session cannot.
 *
 * Pending rows live in this process only. A token issued on another process
 * is absent here and fails closed with `"unknown"`. Do not add shared storage.
 */

/** Typed confirmation phrase for irreversible MCP writes. */
export const MCP_CONFIRM_PHRASE = "CONFIRM" as const;

/**
 * Auth session a confirmation is bound to.
 *
 * `sid` is `McpRequester.sessionId` (`claims.sid`), not the MCP transport
 * session id from `initialize`.
 */
export interface ConfirmationTarget {
  /** Operator principal id (`claims.sub`). */
  readonly principalId: string;
  /** Auth session id (`claims.sid`). */
  readonly sid: string;
}

/**
 * Confirmation after a different session has issued its token.
 *
 * The write rejection that opens a confirmation never carries `token`.
 */
export interface PendingConfirmation {
  /** Opaque id returned to the requester. Not a token. */
  readonly confirmationId: string;
  /** Cryptographically random token. Present only after issue. */
  readonly token: string;
  /** Tool name the token authorises. */
  readonly tool: string;
  /** SHA-256 of canonical JSON arguments. */
  readonly argsDigest: string;
  /** Requester the write is bound to. */
  readonly target: ConfirmationTarget;
  /** Auth session that issued the token. Distinct from {@link ConfirmationTarget.sid}. */
  readonly issuerSid: string;
  /** Expiry epoch-ms. */
  readonly expiresAt: number;
  /** Human reason recorded when the token was issued. */
  readonly reason: string;
}

/**
 * Opaque handle for a write that still needs another session to confirm.
 *
 * This is not a token and must not be accepted by {@link ConfirmationGate.consume}.
 */
export interface OpenConfirmation {
  /** Id to pass to `oke.action.confirm`. */
  readonly confirmationId: string;
  /** Expiry epoch-ms of the pending row. */
  readonly expiresAt: number;
}

/** Result of issuing a confirmation token from a second session. */
export type ConfirmIssueResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly tool: string;
      readonly expiresAt: number;
    }
  | {
      readonly ok: false;
      readonly reason: "unknown" | "expired" | "same-session" | "reason-short" | "already-issued";
    };

/** Result of consuming a confirmation. */
export type ConfirmConsumeResult =
  | { readonly ok: true; readonly pending: PendingConfirmation }
  | {
      readonly ok: false;
      readonly reason:
        | "missing"
        | "unknown"
        | "expired"
        | "tool-mismatch"
        | "args-mismatch"
        | "session-mismatch"
        | "issuer-mismatch"
        | "phrase-mismatch"
        | "reason-short";
    };

/** Options for {@link createConfirmationGate}. */
export interface ConfirmationGateOptions {
  readonly now?: () => number;
  /** Token TTL (default 2 minutes). */
  readonly ttlMs?: number;
}

/**
 * In-process confirmation gate with **no session-level cache**.
 *
 * Tokens are single-use and bound to tool + args digest + target session.
 * The map is per process: an id or token issued elsewhere fails closed
 * with `"unknown"`. Do not add shared storage.
 */
export interface ConfirmationGate {
  /**
   * Bind a write attempt to the requester.
   *
   * Returns an opaque confirmation id and never a token.
   *
   * @param input - Tool, arguments, and requester session
   */
  readonly open: (input: {
    readonly tool: string;
    readonly args: unknown;
    readonly target: ConfirmationTarget;
  }) => OpenConfirmation;
  /**
   * Issue a single-use token for an open confirmation.
   *
   * Succeeds only when `callerSid` is not the target session.
   *
   * @param input - Confirmation id, reason, and issuer session
   */
  readonly issue: (input: {
    readonly confirmationId: string;
    readonly reason: string;
    readonly callerSid: string;
  }) => ConfirmIssueResult;
  /**
   * Consume a token for one write.
   *
   * Requires `consumerSid === target.sid` and `issuerSid !== consumerSid`,
   * plus single-use, tool, args digest, expiry, and phrase checks.
   *
   * @param input - Write attempt presenting the token
   */
  readonly consume: (input: {
    readonly tool: string;
    readonly args: unknown;
    readonly consumerSid: string;
    readonly token: string;
    readonly phrase: string;
    readonly reason: string;
  }) => ConfirmConsumeResult;
  /** Test helper — pending count (never used for consent caching). */
  readonly size: () => number;
}

/** Mutable row stored in the per-process maps. */
interface ConfirmationRecord {
  confirmationId: string;
  token: string | null;
  tool: string;
  argsDigest: string;
  target: ConfirmationTarget;
  issuerSid: string | null;
  expiresAt: number;
  reason: string;
}

/**
 * Create a confirmation gate with **no session-level cache**.
 *
 * @param options - Clock and TTL
 */
export function createConfirmationGate(options: ConfirmationGateOptions = {}): ConfirmationGate {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? 2 * 60 * 1000;
  // Per-process only. A token issued on another process is not in these maps
  // and fails closed with "unknown". Do not add shared storage.
  const byId = new Map<string, ConfirmationRecord>();
  const byToken = new Map<string, ConfirmationRecord>();

  return {
    open(input) {
      prune(byId, byToken, now());
      const confirmationId = `mcp_id_${cryptoRandomHex(24)}`;
      const entry: ConfirmationRecord = {
        confirmationId,
        token: null,
        tool: input.tool,
        argsDigest: digestArgs(input.args),
        target: input.target,
        issuerSid: null,
        expiresAt: now() + ttlMs,
        reason: "",
      };
      byId.set(confirmationId, entry);
      return { confirmationId, expiresAt: entry.expiresAt };
    },
    issue(input) {
      if (input.reason.trim().length < 3) {
        return { ok: false, reason: "reason-short" };
      }
      prune(byId, byToken, now());
      const entry = byId.get(input.confirmationId);
      if (!entry) {
        return { ok: false, reason: "unknown" };
      }
      if (entry.expiresAt <= now()) {
        drop(byId, byToken, entry);
        return { ok: false, reason: "expired" };
      }
      // Same auth session cannot request, confirm, and invoke.
      if (input.callerSid === entry.target.sid) {
        return { ok: false, reason: "same-session" };
      }
      if (entry.token !== null) {
        return { ok: false, reason: "already-issued" };
      }
      const token = `mcp_c_${cryptoRandomHex(24)}`;
      entry.token = token;
      entry.issuerSid = input.callerSid;
      entry.reason = input.reason.trim();
      byToken.set(token, entry);
      return { ok: true, token, tool: entry.tool, expiresAt: entry.expiresAt };
    },
    consume(input) {
      prune(byId, byToken, now());
      if (!input.token) {
        return { ok: false, reason: "missing" };
      }
      if (input.phrase.trim() !== MCP_CONFIRM_PHRASE) {
        return { ok: false, reason: "phrase-mismatch" };
      }
      if (input.reason.trim().length < 3) {
        return { ok: false, reason: "reason-short" };
      }
      const entry = byToken.get(input.token);
      if (!entry) {
        // Missing locally — including a token issued on another process.
        return { ok: false, reason: "unknown" };
      }
      // Reject before drop. A wrong session must not burn the single-use token.
      // There is no await between the checks and the drop, so one process
      // still consumes the token at most once.
      if (entry.expiresAt <= now()) {
        return { ok: false, reason: "expired" };
      }
      if (entry.tool !== input.tool) {
        return { ok: false, reason: "tool-mismatch" };
      }
      if (entry.argsDigest !== digestArgs(input.args)) {
        return { ok: false, reason: "args-mismatch" };
      }
      if (entry.target.sid !== input.consumerSid) {
        return { ok: false, reason: "session-mismatch" };
      }
      if (entry.issuerSid === null || entry.issuerSid === input.consumerSid) {
        return { ok: false, reason: "issuer-mismatch" };
      }
      if (entry.token === null) {
        return { ok: false, reason: "unknown" };
      }
      drop(byId, byToken, entry);
      return {
        ok: true,
        pending: {
          confirmationId: entry.confirmationId,
          token: entry.token,
          tool: entry.tool,
          argsDigest: entry.argsDigest,
          target: entry.target,
          issuerSid: entry.issuerSid,
          expiresAt: entry.expiresAt,
          reason: entry.reason,
        },
      };
    },
    size() {
      prune(byId, byToken, now());
      return byId.size;
    },
  };
}

/**
 * Canonical SHA-256 digest of tool arguments (hex).
 *
 * @param args - Tool arguments
 */
export function digestArgs(args: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(canonicalJson(args));
  return hasher.digest("hex");
}

function drop(
  byId: Map<string, ConfirmationRecord>,
  byToken: Map<string, ConfirmationRecord>,
  entry: ConfirmationRecord,
): void {
  byId.delete(entry.confirmationId);
  if (entry.token !== null) byToken.delete(entry.token);
}

function cryptoRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function prune(
  byId: Map<string, ConfirmationRecord>,
  byToken: Map<string, ConfirmationRecord>,
  t: number,
): void {
  for (const entry of byId.values()) {
    if (entry.expiresAt <= t) drop(byId, byToken, entry);
  }
}
