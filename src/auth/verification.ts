/**
 * Shared verification / challenge store for magic-link, OTP, phone, etc.
 */

/** Delivery channel for Tier-2 OTP challenges. */
export type OtpChannel = "sms" | "whatsapp" | "email";

/** One pending challenge. */
export interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt: number;
  createdAt: number;
  consumedAt: number | null;
  attempts: number;
  /**
   * Tier-2 sealed OTP (AES-GCM via HKDF `oke-otp-seal-v1`).
   * Wiped on consume / expire — never left after TTL.
   */
  sealedOtp?: string | null;
  /** Last successful delivery time (resend cooldown). */
  lastDeliveredAt?: number;
  /** Last channel used for delivery. */
  lastChannel?: OtpChannel;
  /** Email address captured at request (channel-neutral challenge). */
  email?: string | null;
  /** E.164 phone captured at request. */
  phone?: string | null;
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
 * Wipe the sealed OTP copy (and clear the field). Safe to call repeatedly.
 *
 * @param row - Challenge row
 */
export function wipeSealedOtp(row: VerificationRow): void {
  row.sealedOtp = null;
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
 * Expired active rows have their sealed OTP wiped before being skipped.
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
    if (row.expiresAt <= now) {
      wipeSealedOtp(row);
      continue;
    }
    return row;
  }
  return undefined;
}

/**
 * Consume a challenge: set `consumedAt`, wipe sealed OTP.
 *
 * @param row - Active challenge
 * @param now - Clock
 */
export function consumeVerification(row: VerificationRow, now: number): void {
  row.consumedAt = now;
  wipeSealedOtp(row);
}

/**
 * Invalidate every non-consumed challenge for an identifier (fresh request).
 * Wipes sealed copies on the invalidated rows.
 *
 * @param store - Store
 * @param identifier - Challenge key
 * @param now - Clock
 */
export function invalidateVerifications(
  store: VerificationStore,
  identifier: string,
  now: number,
): void {
  for (const row of store.rows.values()) {
    if (row.identifier === identifier && row.consumedAt === null) {
      consumeVerification(row, now);
    }
  }
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
