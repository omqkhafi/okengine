/**
 * First-admin claim code — printed once to the boot log.
 *
 * Not stored in Postgres. While setup is open, the same code is mirrored to
 * `.oke/claim-code` (mode 0600, gitignored) so `oke console claim-code` can
 * re-print it without scrolling the boot log. File is removed after a
 * successful claim or when setup is already closed at boot.
 *
 * Expires in 30 minutes, regenerates on restart. Compared in constant time
 * and rate-limited (console §2.5 · §10.4).
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatClaimNote } from "../../term.ts";
import { AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS, touchRateLimit } from "./auth-rate.ts";
import { CONSOLE_OKE_DIR } from "./operator-db.ts";

/** Claim-code lifetime (30 minutes). */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

/** Max verification attempts per window (same strategy as operator login). */
export const CLAIM_RATE_LIMIT = AUTH_RATE_LIMIT;

/** Rate-limit window (same strategy as operator login). */
export const CLAIM_RATE_WINDOW_MS = AUTH_RATE_WINDOW_MS;

/** Filename under `.oke/` for the local DX claim mirror. */
export const CLAIM_CODE_FILE = "claim-code";

/** In-memory claim-code state for one Console boot. */
export interface ClaimCodeState {
  /** Raw code (mirrored to `.oke/claim-code` while setup is open). */
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

/** On-disk claim mirror written for local DX (`oke console claim-code`). */
export interface ClaimCodeArtifact {
  readonly code: string;
  readonly expiresAt: number;
  readonly mintedAt: number;
}

/**
 * Absolute path to `.oke/claim-code` under a project root.
 *
 * @param cwd - Project root
 */
export function claimCodeArtifactPath(cwd: string): string {
  return join(cwd, CONSOLE_OKE_DIR, CLAIM_CODE_FILE);
}

/**
 * Mirror the boot claim code to `.oke/claim-code` (0600).
 *
 * @param cwd - Project root
 * @param state - Minted claim state
 * @returns Absolute path written
 */
export function writeClaimCodeArtifact(
  cwd: string,
  state: Pick<ClaimCodeState, "code" | "expiresAt" | "mintedAt">,
): string {
  const dir = join(cwd, CONSOLE_OKE_DIR);
  mkdirSync(dir, { recursive: true });
  const path = claimCodeArtifactPath(cwd);
  const body: ClaimCodeArtifact = {
    code: state.code,
    expiresAt: state.expiresAt,
    mintedAt: state.mintedAt,
  };
  writeFileSync(path, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  return path;
}

/**
 * Remove `.oke/claim-code` if present (setup closed / claim succeeded).
 *
 * @param cwd - Project root
 */
export function clearClaimCodeArtifact(cwd: string): void {
  try {
    unlinkSync(claimCodeArtifactPath(cwd));
  } catch {
    // missing is fine
  }
}

/** Result of {@link readClaimCodeArtifact}. */
export type ReadClaimCodeArtifactResult =
  | { readonly ok: true; readonly artifact: ClaimCodeArtifact; readonly path: string }
  | {
      readonly ok: false;
      readonly reason: "missing" | "expired" | "invalid";
      readonly path: string;
    };

/**
 * Read and validate the local claim-code mirror.
 *
 * @param cwd - Project root
 * @param now - Clock
 */
export function readClaimCodeArtifact(
  cwd: string,
  now: () => number = Date.now,
): ReadClaimCodeArtifactResult {
  const path = claimCodeArtifactPath(cwd);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch {
    return { ok: false, reason: "missing", path };
  }
  if (raw.length === 0) return { ok: false, reason: "invalid", path };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain hex (legacy / Playwright-style) — treat as expired-unknown without TTL.
    if (/^[0-9a-f]{32}$/i.test(raw)) {
      return {
        ok: true,
        path,
        artifact: { code: raw.toLowerCase(), expiresAt: Number.POSITIVE_INFINITY, mintedAt: 0 },
      };
    }
    return { ok: false, reason: "invalid", path };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, reason: "invalid", path };
  }
  const o = parsed as Record<string, unknown>;
  const code = o["code"];
  const expiresAt = o["expiresAt"];
  const mintedAt = o["mintedAt"];
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    typeof mintedAt !== "number" ||
    !Number.isFinite(mintedAt)
  ) {
    return { ok: false, reason: "invalid", path };
  }

  if (now() >= expiresAt) {
    return { ok: false, reason: "expired", path };
  }

  return {
    ok: true,
    path,
    artifact: { code, expiresAt, mintedAt },
  };
}

/**
 * Mint a cryptographically random claim code.
 *
 * @param now - Clock (injectable for tests)
 */
export function mintClaimCode(now: () => number = Date.now): ClaimCodeState {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const code = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
): void {
  if (state.printed) return;
  state.printed = true;
  write(formatClaimNote(state.code));
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
  if (touchRateLimit(state.attempts, t) === "rate_limited") {
    return { ok: false, reason: "rate_limited" };
  }

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
