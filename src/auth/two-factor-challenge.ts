import { okid } from "../okid.ts";
/**
 * Pending login 2FA challenges + short-lived step-up grants.
 *
 * One active unresolved challenge per user; method is locked at issue time
 * so enrollment / method-switch cannot bypass the configured factor.
 */

/** Locked second-factor method for a login challenge. */
export type TwoFactorMethod = "totp" | "email_otp";

/** Default login-challenge TTL (align with OTP). */
export const DEFAULT_TWO_FACTOR_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** Default step-up grant TTL for privileged 2FA ops. */
export const DEFAULT_STEP_UP_TTL_MS = 5 * 60 * 1000;

/** One pending login 2FA challenge. */
export interface PendingTwoFactorChallenge {
  id: string;
  userId: string;
  method: TwoFactorMethod;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

/** In-memory pending 2FA challenge store. */
export interface PendingTwoFactorStore {
  readonly byId: Map<string, PendingTwoFactorChallenge>;
  /** userId → active challenge id (at most one). */
  readonly byUserId: Map<string, string>;
}

/**
 * Create an empty pending 2FA challenge store.
 */
export function createPendingTwoFactorStore(): PendingTwoFactorStore {
  return { byId: new Map(), byUserId: new Map() };
}

/** Options for {@link issueChallenge}. */
export interface IssueChallengeOptions {
  readonly userId: string;
  readonly method: TwoFactorMethod;
  readonly now?: number;
  readonly ttlMs?: number;
}

/**
 * Invalidate any prior active challenge for the user and issue a new locked one.
 *
 * @param store - Pending store
 * @param options - User, method, clock
 */
export function issueChallenge(
  store: PendingTwoFactorStore,
  options: IssueChallengeOptions,
): PendingTwoFactorChallenge {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TWO_FACTOR_CHALLENGE_TTL_MS;
  invalidateActiveForUser(store, options.userId, now);
  const row: PendingTwoFactorChallenge = {
    id: okid(),
    userId: options.userId,
    method: options.method,
    createdAt: now,
    expiresAt: now + ttlMs,
    consumedAt: null,
  };
  store.byId.set(row.id, row);
  store.byUserId.set(options.userId, row.id);
  return row;
}

/**
 * Find a non-consumed, non-expired challenge by id.
 *
 * @param store - Pending store
 * @param challengeId - Challenge id
 * @param now - Clock
 */
export function getChallenge(
  store: PendingTwoFactorStore,
  challengeId: string,
  now: number = Date.now(),
): PendingTwoFactorChallenge | undefined {
  const row = store.byId.get(challengeId);
  if (!row) return undefined;
  if (row.consumedAt !== null) return undefined;
  if (row.expiresAt <= now) {
    clearUserPointer(store, row);
    return undefined;
  }
  return row;
}

/**
 * Find the active unresolved challenge for a user, if any.
 *
 * @param store - Pending store
 * @param userId - User id
 * @param now - Clock
 */
export function findActiveForUser(
  store: PendingTwoFactorStore,
  userId: string,
  now: number = Date.now(),
): PendingTwoFactorChallenge | undefined {
  const id = store.byUserId.get(userId);
  if (!id) return undefined;
  const row = getChallenge(store, id, now);
  if (!row) {
    store.byUserId.delete(userId);
    return undefined;
  }
  return row;
}

/**
 * True when the user has an active unresolved login 2FA challenge.
 *
 * @param store - Pending store
 * @param userId - User id
 * @param now - Clock
 */
export function hasActiveChallenge(
  store: PendingTwoFactorStore,
  userId: string,
  now: number = Date.now(),
): boolean {
  return findActiveForUser(store, userId, now) !== undefined;
}

/**
 * Consume a challenge after successful verification.
 *
 * @param store - Pending store
 * @param row - Active challenge
 * @param now - Clock
 */
export function consumeChallenge(
  store: PendingTwoFactorStore,
  row: PendingTwoFactorChallenge,
  now: number = Date.now(),
): void {
  row.consumedAt = now;
  clearUserPointer(store, row);
}

/**
 * Invalidate the active challenge for a user (fresh sign-in / abort).
 *
 * @param store - Pending store
 * @param userId - User id
 * @param now - Clock
 */
export function invalidateActiveForUser(
  store: PendingTwoFactorStore,
  userId: string,
  now: number = Date.now(),
): void {
  const id = store.byUserId.get(userId);
  if (!id) return;
  const row = store.byId.get(id);
  if (row && row.consumedAt === null) {
    row.consumedAt = now;
  }
  store.byUserId.delete(userId);
}

function clearUserPointer(store: PendingTwoFactorStore, row: PendingTwoFactorChallenge): void {
  if (store.byUserId.get(row.userId) === row.id) {
    store.byUserId.delete(row.userId);
  }
}

/** Privileged step-up grant after verifying the current 2FA method. */
export interface StepUpGrant {
  userId: string;
  expiresAt: number;
  purpose: "enroll" | "change" | "disable";
}

/** In-memory step-up grant store. */
export interface StepUpStore {
  readonly byUserId: Map<string, StepUpGrant>;
}

/**
 * Create an empty step-up grant store.
 */
export function createStepUpStore(): StepUpStore {
  return { byUserId: new Map() };
}

/**
 * Record a short-lived step-up grant for privileged 2FA operations.
 *
 * @param store - Step-up store
 * @param userId - User id
 * @param purpose - Intended privileged op
 * @param now - Clock
 * @param ttlMs - Grant TTL
 */
export function grantStepUp(
  store: StepUpStore,
  userId: string,
  purpose: StepUpGrant["purpose"],
  now: number = Date.now(),
  ttlMs: number = DEFAULT_STEP_UP_TTL_MS,
): StepUpGrant {
  const grant: StepUpGrant = { userId, purpose, expiresAt: now + ttlMs };
  store.byUserId.set(userId, grant);
  return grant;
}

/**
 * Consume a valid step-up grant (single-use). Returns false if missing/expired/wrong purpose.
 *
 * @param store - Step-up store
 * @param userId - User id
 * @param purpose - Required purpose (or any of the listed)
 * @param now - Clock
 */
export function consumeStepUp(
  store: StepUpStore,
  userId: string,
  purpose: StepUpGrant["purpose"] | readonly StepUpGrant["purpose"][],
  now: number = Date.now(),
): boolean {
  const grant = store.byUserId.get(userId);
  if (!grant) return false;
  if (grant.expiresAt <= now) {
    store.byUserId.delete(userId);
    return false;
  }
  const allowed = typeof purpose === "string" ? [purpose] : purpose;
  if (!allowed.includes(grant.purpose)) return false;
  store.byUserId.delete(userId);
  return true;
}

/**
 * Peek whether a valid step-up grant exists (does not consume).
 *
 * @param store - Step-up store
 * @param userId - User id
 * @param purpose - Required purpose
 * @param now - Clock
 */
export function hasStepUp(
  store: StepUpStore,
  userId: string,
  purpose: StepUpGrant["purpose"] | readonly StepUpGrant["purpose"][],
  now: number = Date.now(),
): boolean {
  const grant = store.byUserId.get(userId);
  if (!grant) return false;
  if (grant.expiresAt <= now) {
    store.byUserId.delete(userId);
    return false;
  }
  const allowed = typeof purpose === "string" ? [purpose] : purpose;
  return allowed.includes(grant.purpose);
}

/** Sign-in response when 2FA must complete before session issue. */
export interface TwoFactorRequiredOut {
  readonly twoFactorRequired: true;
  readonly challengeId: string;
  readonly method: TwoFactorMethod;
  readonly userId: string;
  readonly devOtp?: string;
}

/**
 * Verification-store identifier for email OTP used as a second factor.
 *
 * @param userId - User id
 */
export function twoFactorEmailOtpIdentifier(userId: string): string {
  return `2fa:${userId}`;
}
