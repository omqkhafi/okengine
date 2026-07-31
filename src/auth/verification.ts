/**
 * Shared verification / challenge store for magic-link, OTP, phone, etc.
 */

/** One pending challenge. */
export interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt: number;
  createdAt: number;
  consumedAt: number | null;
  attempts: number;
}

/** In-memory verification store. */
export interface VerificationStore {
  rows: Map<string, VerificationRow>;
}

/**
 * Create an empty verification store.
 */
export function createVerificationStore(): VerificationStore {
  return { rows: new Map() };
}

/**
 * Store a challenge (hashed value recommended by callers).
 *
 * @param store - Store
 * @param row - Challenge row
 */
export function putVerification(store: VerificationStore, row: VerificationRow): void {
  store.rows.set(row.id, row);
}

/**
 * Find a non-consumed, non-expired challenge by identifier.
 *
 * @param store - Store
 * @param identifier - Email / phone / username key
 * @param now - Clock
 */
export function findActiveVerification(
  store: VerificationStore,
  identifier: string,
  now: number,
): VerificationRow | undefined {
  for (const row of store.rows.values()) {
    if (row.identifier !== identifier) continue;
    if (row.consumedAt !== null) continue;
    if (row.expiresAt <= now) continue;
    return row;
  }
  return undefined;
}

/**
 * SHA-256 hex hash for challenge secrets / OTPs.
 *
 * @param raw - Raw secret
 */
export async function hashChallenge(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a numeric OTP of `digits` length.
 *
 * @param digits - Length (default 6)
 */
export function generateOtp(digits = 6): string {
  const max = 10 ** digits;
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % max;
  return n.toString().padStart(digits, "0");
}
