/**
 * Per-call human confirmation for sensitive / irreversible MCP actions.
 *
 * console §10.3: no session-level consent caching. Approving once and never
 * re-validating is how tool poisoning and rug pulls persist. Every write
 * (or otherwise sensitive) tool invocation must carry a fresh confirmation
 * token that was issued for that exact tool + arguments digest.
 */

/** Typed confirmation phrase for irreversible MCP writes. */
export const MCP_CONFIRM_PHRASE = "CONFIRM" as const;

/** Pending confirmation that has not yet been consumed. */
export interface PendingConfirmation {
  /** Cryptographically random token. */
  readonly token: string;
  /** Tool name the token authorises. */
  readonly tool: string;
  /** SHA-256 of canonical JSON arguments. */
  readonly argsDigest: string;
  /** Operator / principal id that requested it. */
  readonly principalId: string;
  /** Expiry epoch-ms. */
  readonly expiresAt: number;
  /** Human reason recorded at request time. */
  readonly reason: string;
}

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
        | "principal-mismatch"
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
 * Create a confirmation gate with **no session-level cache**.
 * Tokens are single-use and bound to tool + args + principal.
 */
export function createConfirmationGate(options: ConfirmationGateOptions = {}): {
  readonly request: (input: {
    readonly tool: string;
    readonly args: unknown;
    readonly principalId: string;
    readonly reason: string;
  }) => PendingConfirmation | { readonly error: "reason-short" };
  readonly consume: (input: {
    readonly tool: string;
    readonly args: unknown;
    readonly principalId: string;
    readonly token: string;
    readonly phrase: string;
    readonly reason: string;
  }) => ConfirmConsumeResult;
  /** Test helper — pending count (never used for consent caching). */
  readonly size: () => number;
} {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? 2 * 60 * 1000;
  const pending = new Map<string, PendingConfirmation>();

  return {
    request(input) {
      if (input.reason.trim().length < 3) {
        return { error: "reason-short" as const };
      }
      prune(pending, now());
      const token = `mcp_c_${cryptoRandomHex(24)}`;
      const entry: PendingConfirmation = {
        token,
        tool: input.tool,
        argsDigest: digestArgs(input.args),
        principalId: input.principalId,
        expiresAt: now() + ttlMs,
        reason: input.reason.trim(),
      };
      pending.set(token, entry);
      return entry;
    },
    consume(input) {
      prune(pending, now());
      if (!input.token) {
        return { ok: false, reason: "missing" };
      }
      if (input.phrase.trim() !== MCP_CONFIRM_PHRASE) {
        return { ok: false, reason: "phrase-mismatch" };
      }
      if (input.reason.trim().length < 3) {
        return { ok: false, reason: "reason-short" };
      }
      const entry = pending.get(input.token);
      if (!entry) {
        return { ok: false, reason: "unknown" };
      }
      // Single-use: remove before further checks so replay fails.
      pending.delete(input.token);
      if (entry.expiresAt <= now()) {
        return { ok: false, reason: "expired" };
      }
      if (entry.tool !== input.tool) {
        return { ok: false, reason: "tool-mismatch" };
      }
      if (entry.argsDigest !== digestArgs(input.args)) {
        return { ok: false, reason: "args-mismatch" };
      }
      if (entry.principalId !== input.principalId) {
        return { ok: false, reason: "principal-mismatch" };
      }
      return { ok: true, pending: entry };
    },
    size() {
      prune(pending, now());
      return pending.size;
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

function prune(pending: Map<string, PendingConfirmation>, t: number): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= t) pending.delete(token);
  }
}
