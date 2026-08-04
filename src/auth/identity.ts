/**
 * User-plane identity + credential store (email/password Gate auth).
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import { createBunCrypto } from "../runtime/primitives.ts";
import { assertNotBreached, type BreachCheckFn } from "./breach-check.ts";
import { assertPasswordPolicy, type PasswordPolicyOptions } from "./password-policy.ts";

/** User-plane identity row (logical). */
export interface UserIdentityRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  createdAt: number;
  updatedAt: number;
  /** Extra fields from `additionalFields`. */
  extra: Record<string, unknown>;
}

/** Credential account linked to a user. */
export interface UserAccountRow {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  passwordHash: string | null;
  createdAt: number;
  updatedAt: number;
}

/** In-memory user identity store. */
export interface IdentityStore {
  users: Map<string, UserIdentityRow>;
  /** Lowercased email → user id. */
  byEmail: Map<string, string>;
  accounts: Map<string, UserAccountRow>;
  /** `provider:providerAccountId` → account id. */
  byProvider: Map<string, string>;
}

/**
 * Create an empty identity store.
 */
export function createIdentityStore(): IdentityStore {
  return {
    users: new Map(),
    byEmail: new Map(),
    accounts: new Map(),
    byProvider: new Map(),
  };
}

/** Options for {@link createUserWithPassword}. */
export interface CreateUserWithPasswordOptions {
  readonly email: string;
  readonly password: string;
  readonly name?: string;
  readonly id?: string;
  readonly emailVerified?: boolean;
  readonly extra?: Record<string, unknown>;
  readonly passwordPolicy?: PasswordPolicyOptions;
  readonly skipPasswordPolicy?: boolean;
  readonly passwordHash?: PasswordHashOptions;
  readonly breachCheck?: BreachCheckFn;
  readonly now?: () => number;
}

/**
 * Normalize email for lookup / uniqueness.
 *
 * @param email - Raw email
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Find or create a user row keyed by email (magic-link / OTP sign-in).
 *
 * @param store - Identity store
 * @param email - Normalized email
 * @param now - Clock
 */
export function ensureUserByEmail(
  store: IdentityStore,
  email: string,
  now: number,
): UserIdentityRow {
  const existingId = store.byEmail.get(email);
  if (existingId) {
    const existing = store.users.get(existingId);
    if (existing) return existing;
  }
  const id = crypto.randomUUID();
  const user: UserIdentityRow = {
    id,
    email,
    name: email.split("@")[0] || "user",
    emailVerified: true,
    status: "active",
    createdAt: now,
    updatedAt: now,
    extra: {},
  };
  store.users.set(id, user);
  store.byEmail.set(email, id);
  return user;
}

/**
 * Create a user with a credential account (provider `credential`).
 *
 * @param store - Identity store
 * @param options - Email + password + profile
 */
export async function createUserWithPassword(
  store: IdentityStore,
  options: CreateUserWithPasswordOptions,
): Promise<UserIdentityRow> {
  const email = normalizeEmail(options.email);
  if (!email.includes("@")) {
    throw new IdentityError("invalid_email", "invalid email");
  }
  if (store.byEmail.has(email)) {
    throw new IdentityError("email_taken", "email already registered");
  }
  if (!options.skipPasswordPolicy) {
    assertPasswordPolicy(options.password, options.passwordPolicy ?? {});
  }
  await assertNotBreached(options.password, options.breachCheck);

  const crypto = createBunCrypto();
  const now = options.now ?? (() => Date.now());
  const t = now();
  const id = options.id ?? crypto.randomUUID();
  const user: UserIdentityRow = {
    id,
    email,
    name: options.name?.trim() || email.split("@")[0] || "user",
    emailVerified: options.emailVerified === true,
    status: "active",
    createdAt: t,
    updatedAt: t,
    extra: { ...(options.extra ?? {}) },
  };
  const accountId = crypto.randomUUID();
  const account: UserAccountRow = {
    id: accountId,
    userId: id,
    provider: "credential",
    providerAccountId: email,
    passwordHash: await crypto.hashPassword(
      options.password,
      options.passwordHash ?? { algorithm: "argon2id" },
    ),
    createdAt: t,
    updatedAt: t,
  };

  store.users.set(id, user);
  store.byEmail.set(email, id);
  store.accounts.set(accountId, account);
  store.byProvider.set(`credential:${email}`, accountId);
  return user;
}

/**
 * Authenticate email + password. Enumeration-safe: same timing path on miss.
 *
 * @param store - Identity store
 * @param email - Submitted email
 * @param password - Submitted password
 */
export async function authenticateUser(
  store: IdentityStore,
  email: string,
  password: string,
): Promise<UserIdentityRow | null> {
  const crypto = createBunCrypto();
  const key = normalizeEmail(email);
  const userId = store.byEmail.get(key);
  const user = userId ? store.users.get(userId) : undefined;
  const accountId = store.byProvider.get(`credential:${key}`);
  const account = accountId ? store.accounts.get(accountId) : undefined;
  const hash = account?.passwordHash ?? (await dummyHash(crypto));
  const ok = await crypto.verifyPassword(password, hash);
  if (!ok || !user || user.status !== "active") return null;
  return user;
}

/**
 * Look up a user by id.
 *
 * @param store - Identity store
 * @param id - User id
 */
export function getUserById(store: IdentityStore, id: string): UserIdentityRow | undefined {
  return store.users.get(id);
}

/** Identity-plane error. */
export class IdentityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

/** Dummy argon2id hash so missing-user paths pay a verify round-trip. */
let dummyPasswordHash: string | null = null;

async function dummyHash(crypto: ReturnType<typeof createBunCrypto>): Promise<string> {
  if (dummyPasswordHash === null) {
    dummyPasswordHash = await crypto.hashPassword("oke-user-timing-dummy", "argon2id");
  }
  return dummyPasswordHash;
}
