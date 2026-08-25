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
  /** Optional write-through user persist (SQL). Bound at host boot. */
  persistUser?: (row: UserIdentityRow) => void | Promise<void>;
  /** Optional write-through account persist (SQL). Bound at host boot. */
  persistAccount?: (row: UserAccountRow) => void | Promise<void>;
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
export async function ensureUserByEmail(
  store: IdentityStore,
  email: string,
  now: number,
): Promise<UserIdentityRow> {
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
  await store.persistUser?.(user);
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
  await Promise.all([store.persistUser?.(user), store.persistAccount?.(account)]);
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

/** Options for {@link linkOrProvision}. */
export interface LinkOrProvisionOptions {
  /** Provider name (`magic-link`, `otp`, `passkey`, `username`, `anonymous`). */
  readonly provider: string;
  /** Provider-scoped subject (email, phone, username, credential id). */
  readonly providerAccountId: string;
  /** Email to attach to a freshly provisioned user (normalized by the store). */
  readonly email?: string;
  /** Email-verified claim (only when provisioning). */
  readonly emailVerified?: boolean;
  /** Display name when provisioning. */
  readonly name?: string;
  /** Optional password hash for the account row. */
  readonly passwordHash?: string | null;
  /** Currently authenticated `fx.auth.userId`, when the request is authenticated. */
  readonly currentUserId?: string;
  /** Injectable clock. */
  readonly now?: () => number;
}

/** Result of {@link linkOrProvision}. */
export interface LinkedCredential {
  readonly user: UserIdentityRow;
  readonly account: UserAccountRow;
  /** `true` when a new account was written (vs plain sign-in resolution). */
  readonly created: boolean;
}

/**
 * The single shared credential-write path across Gate auth method plugins.
 *
 * Enforces the locked account-linking rule centrally:
 * - An existing `provider:providerAccountId` resolves to its user (sign-in).
 * - A new credential may attach to an existing user ONLY when the request is
 *   already authenticated as that user (`currentUserId` matches).
 * - An unauthenticated new credential whose email is already owned by another
 *   user is REFUSED (`email_in_use`) — never auto-linked by email match alone.
 *
 * @param store - Shared identity store
 * @param options - Credential + linking context
 */
export async function linkOrProvision(
  store: IdentityStore,
  options: LinkOrProvisionOptions,
): Promise<LinkedCredential> {
  const { provider, providerAccountId } = options;
  const now = options.now ?? (() => Date.now());
  const key = `${provider}:${providerAccountId}`;

  // 1. Existing credential → plain sign-in resolution (no linking needed).
  const existingAccountId = store.byProvider.get(key);
  if (existingAccountId) {
    const account = store.accounts.get(existingAccountId);
    const user = account ? store.users.get(account.userId) : undefined;
    if (account && user) return { user, account, created: false };
  }

  const email = options.email ? normalizeEmail(options.email) : undefined;
  const emailOwnerId = email ? store.byEmail.get(email) : undefined;
  if (emailOwnerId) {
    if (options.currentUserId) {
      if (emailOwnerId !== options.currentUserId) {
        throw new IdentityError("email_conflict", "email belongs to another user");
      }
    } else {
      throw new IdentityError("email_in_use", "email already registered to another credential");
    }
  }

  const t = now();
  const userId = options.currentUserId ?? crypto.randomUUID();
  const existingUser = store.users.get(userId);
  const user: UserIdentityRow = existingUser ?? {
    id: userId,
    email: email ?? "",
    name: options.name?.trim() || (email ? email.split("@")[0] || "user" : "user"),
    emailVerified: options.emailVerified === true,
    status: "active",
    createdAt: t,
    updatedAt: t,
    extra: {},
  };
  const account: UserAccountRow = {
    id: crypto.randomUUID(),
    userId,
    provider,
    providerAccountId,
    passwordHash: options.passwordHash ?? null,
    createdAt: t,
    updatedAt: t,
  };

  const userIsNew = !store.users.has(userId);
  store.users.set(userId, user);
  if (email) store.byEmail.set(email, userId);
  store.accounts.set(account.id, account);
  store.byProvider.set(key, account.id);
  if (userIsNew) await store.persistUser?.(user);
  await store.persistAccount?.(account);
  return { user, account, created: true };
}

/**
 * Ensure a user row exists for `userId` (defensive — two-factor enable on an
 * established session principal).
 *
 * @param store - Shared identity store
 * @param userId - Existing principal id
 * @param now - Clock
 */
export async function ensureUserExists(
  store: IdentityStore,
  userId: string,
  now: number,
): Promise<UserIdentityRow> {
  const existing = store.users.get(userId);
  if (existing) return existing;
  const user: UserIdentityRow = {
    id: userId,
    email: "",
    name: "user",
    emailVerified: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
    extra: {},
  };
  store.users.set(userId, user);
  await store.persistUser?.(user);
  return user;
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
