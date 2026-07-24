/**
 * First-admin claim code — printed once to the boot log, never persisted.
 *
 * Expires in 30 minutes, regenerates on restart. Compared in constant time
 * and rate-limited (console §2.5 · §10.4).
 */

/** Claim-code lifetime (30 minutes). */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

/** Max verification attempts per window. */
export const CLAIM_RATE_LIMIT = 5;

/** Rate-limit window. */
export const CLAIM_RATE_WINDOW_MS = 60 * 1000;

/** In-memory claim-code state for one Console boot. */
export interface ClaimCodeState {
  /** Raw code (never written to disk). */
  readonly code: string;
  /** Epoch-ms when the code expires. */
  readonly expiresAt: number;
  /** Epoch-ms of mint. */
  readonly mintedAt: number;
  /** Whether the code was printed to the boot log. */
  printed: boolean;
  /** Sliding attempt timestamps for rate limiting. */
  readonly attempts: number[];
}

/**
 * Mint a cryptographically random claim code.
 *
 * @param now - Clock (injectable for tests)
 */
export function mintClaimCode(now: () => number = Date.now): ClaimCodeState {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const code = [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const mintedAt = now();
  return {
    code,
    mintedAt,
    expiresAt: mintedAt + CLAIM_TTL_MS,
    printed: false,
    attempts: [],
  };
}

/**
 * Print the claim code once to the boot log. Subsequent calls are no-ops.
 *
 * @param state - Claim state
 * @param write - Writer (defaults to stdout)
 */
export function printClaimCodeOnce(
  state: ClaimCodeState,
  write: (line: string) => void = (line) => console.log(line),
): void {
  if (state.printed) return;
  state.printed = true;
  write("");
  write("┌─────────────────────────────────────────────────────────┐");
  write("│  oke Console — first-admin claim code (expires 30 min)  │");
  write(`│  ${state.code}  │`);
  write("│  Whoever can read this log already owns the server.     │");
  write("└─────────────────────────────────────────────────────────┘");
  write("");
}

/** Result of {@link verifyClaimCode}. */
export type ClaimVerifyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "expired" | "mismatch" | "rate_limited" | "missing";
    };

/**
 * Constant-time claim-code verification with rate limiting.
 *
 * @param state - Claim state (mutated for attempt tracking)
 * @param candidate - Submitted code
 * @param now - Clock
 */
export function verifyClaimCode(
  state: ClaimCodeState | null,
  candidate: string | undefined,
  now: () => number = Date.now,
): ClaimVerifyResult {
  if (!state) return { ok: false, reason: "missing" };
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { ok: false, reason: "mismatch" };
  }

  const t = now();
  // Drop attempts outside the window.
  while (state.attempts.length > 0 && state.attempts[0]! <= t - CLAIM_RATE_WINDOW_MS) {
    state.attempts.shift();
  }
  if (state.attempts.length >= CLAIM_RATE_LIMIT) {
    return { ok: false, reason: "rate_limited" };
  }
  state.attempts.push(t);

  if (t >= state.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  if (!constantTimeEqual(state.code, candidate)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/**
 * Constant-time string equality (UTF-8 code units).
 *
 * @param a - Expected
 * @param b - Candidate
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ac = a.charCodeAt(i) || 0;
    const bc = b.charCodeAt(i) || 0;
    mismatch |= ac ^ bc;
  }
  return mismatch === 0;
}
