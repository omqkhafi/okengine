/**
 * Username + password Gate auth method plugin.
 */

import { assertNotBreached, BreachCheckError, type BreachCheckFn } from "../auth/breach-check.ts";
import { getActiveGateAuthContext } from "../auth/method-context.ts";
import { IdentityError, linkOrProvision } from "../auth/identity.ts";
import {
  assertPasswordPolicy,
  PasswordPolicyError,
  type PasswordPolicyOptions,
} from "../auth/password-policy.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import { createBunCrypto } from "../runtime/primitives.ts";
import type { PasswordHashOptions } from "../runtime/types.ts";
import {
  AuthFailed,
  AuthRateLimited,
  SessionTokensOut,
  SignInOut,
  bindPublicAuth,
  createMethodRuntime,
  fail,
  flow,
  resolveSharedIdentities,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

/** In-memory username credential row. */
export interface UsernameRow {
  readonly userId: string;
  readonly username: string;
  passwordHash: string;
  createdAt: number;
}

/** Username → credential map. */
export interface UsernameStore {
  readonly byUsername: Map<string, UsernameRow>;
  readonly byUserId: Map<string, UsernameRow>;
}

/**
 * Create an empty username store.
 */
export function createUsernameStore(): UsernameStore {
  return { byUsername: new Map(), byUserId: new Map() };
}

/** Default allowed charset after normalize (`a-z`, digits, `.`, `_`, `-`). */
export const DEFAULT_USERNAME_ALLOWED_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789._-" as const;

/** Default minimum username length. */
export const DEFAULT_USERNAME_MIN_LENGTH = 3;

/** Default maximum username length. */
export const DEFAULT_USERNAME_MAX_LENGTH = 64;

/**
 * Default reserved usernames (impersonation + common route collisions).
 * Pass `reserved: []` to opt out; pass a custom list to replace.
 * Use {@link UsernamePolicyOptions.extraReserved} to append.
 */
export const DEFAULT_RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "api",
  "auth",
  "www",
  "console",
  "oke",
  "login",
  "logout",
  "signup",
  "register",
  "me",
  "null",
  "undefined",
  "anonymous",
] as const;

/** Options for {@link assertUsernamePolicy}. */
export interface UsernamePolicyOptions {
  /** Minimum length after normalize (default 3). */
  readonly minLength?: number;
  /** Maximum length after normalize (default 64). */
  readonly maxLength?: number;
  /**
   * Allowed characters after normalize (default `a-z0-9._-`).
   * Replaces the default set. Prefer {@link extraAllowedChars} to keep
   * the default and add more.
   */
  readonly allowedChars?: string;
  /**
   * Characters appended to the base set (`allowedChars` or the default).
   * Duplicates are ignored.
   */
  readonly extraAllowedChars?: string;
  /** Require at least one letter `a-z` (default false). */
  readonly requireLetter?: boolean;
  /** Require at least one digit (default false). */
  readonly requireNumber?: boolean;
  /**
   * Require at least one non-alphanumeric from `allowedChars`
   * (default false).
   */
  readonly requireSymbol?: boolean;
  /** Require the first character to be `a-z` (default false). */
  readonly mustStartWithLetter?: boolean;
  /**
   * Reject leading or trailing non-alphanumeric characters
   * (default true).
   */
  readonly forbidEdgeSymbols?: boolean;
  /**
   * Reject two or more consecutive non-alphanumeric characters
   * (default true).
   */
  readonly forbidConsecutiveSymbols?: boolean;
  /**
   * Reserved names (compared after normalize). Defaults to
   * {@link DEFAULT_RESERVED_USERNAMES}. Pass `[]` to clear the base list;
   * a non-empty list replaces the default (does not merge). Combine with
   * {@link extraReserved} to append.
   */
  readonly reserved?: readonly string[];
  /**
   * Extra reserved names appended after {@link reserved} (or the default).
   */
  readonly extraReserved?: readonly string[];
}

/** Resolved username policy with defaults applied. */
export interface ResolvedUsernamePolicy {
  readonly minLength: number;
  readonly maxLength: number;
  readonly allowedChars: string;
  readonly requireLetter: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
  readonly mustStartWithLetter: boolean;
  readonly forbidEdgeSymbols: boolean;
  readonly forbidConsecutiveSymbols: boolean;
  readonly reserved: ReadonlySet<string>;
}

/**
 * Resolve username policy options with defaults.
 *
 * @param options - Partial policy
 */
export function resolveUsernamePolicy(options: UsernamePolicyOptions = {}): ResolvedUsernamePolicy {
  const minLength = options.minLength ?? DEFAULT_USERNAME_MIN_LENGTH;
  const maxLength = options.maxLength ?? DEFAULT_USERNAME_MAX_LENGTH;
  if (minLength < 1) {
    throw new RangeError("username policy: minLength must be >= 1");
  }
  if (maxLength < minLength) {
    throw new RangeError("username policy: maxLength must be >= minLength");
  }
  const baseChars = options.allowedChars ?? DEFAULT_USERNAME_ALLOWED_CHARS;
  const allowedChars = mergeAllowedChars(baseChars, options.extraAllowedChars);
  if (allowedChars.length === 0) {
    throw new RangeError("username policy: allowedChars must be non-empty");
  }
  const baseReserved =
    options.reserved !== undefined ? options.reserved : DEFAULT_RESERVED_USERNAMES;
  const reservedNames = [...baseReserved, ...(options.extraReserved ?? [])];
  return {
    minLength,
    maxLength,
    allowedChars,
    requireLetter: options.requireLetter ?? false,
    requireNumber: options.requireNumber ?? false,
    requireSymbol: options.requireSymbol ?? false,
    mustStartWithLetter: options.mustStartWithLetter ?? false,
    forbidEdgeSymbols: options.forbidEdgeSymbols ?? true,
    forbidConsecutiveSymbols: options.forbidConsecutiveSymbols ?? true,
    reserved: new Set(reservedNames.map((r) => normalizeUsername(r))),
  };
}

/**
 * Validate a normalized username against policy.
 * Throws {@link UsernamePolicyError}.
 *
 * @param username - Already normalized (`trim` + lowercase)
 * @param options - Policy (defaults applied)
 */
export function assertUsernamePolicy(username: string, options: UsernamePolicyOptions = {}): void {
  const policy = resolveUsernamePolicy(options);
  const reasons: string[] = [];

  if (username.length < policy.minLength) {
    reasons.push(`minLength ${policy.minLength} (got ${username.length})`);
  }
  if (username.length > policy.maxLength) {
    reasons.push(`maxLength ${policy.maxLength} (got ${username.length})`);
  }

  const allowed = new Set(policy.allowedChars);
  for (const ch of username) {
    if (!allowed.has(ch)) {
      reasons.push("allowedChars");
      break;
    }
  }

  if (policy.requireLetter && !/[a-z]/.test(username)) {
    reasons.push("requireLetter");
  }
  if (policy.requireNumber && !/\d/.test(username)) {
    reasons.push("requireNumber");
  }
  if (policy.requireSymbol && !/[^a-z0-9]/.test(username)) {
    reasons.push("requireSymbol");
  }
  if (policy.mustStartWithLetter && !/^[a-z]/.test(username)) {
    reasons.push("mustStartWithLetter");
  }
  if (policy.forbidEdgeSymbols && username.length > 0) {
    if (/^[^a-z0-9]/.test(username) || /[^a-z0-9]$/.test(username)) {
      reasons.push("forbidEdgeSymbols");
    }
  }
  if (policy.forbidConsecutiveSymbols && /[^a-z0-9]{2,}/.test(username)) {
    reasons.push("forbidConsecutiveSymbols");
  }
  if (policy.reserved.has(username)) {
    reasons.push("reserved");
  }

  if (reasons.length > 0) {
    throw new UsernamePolicyError(reasons);
  }
}

/** Username failed policy checks. */
export class UsernamePolicyError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`username policy failed: ${reasons.join(", ")}`);
    this.name = "UsernamePolicyError";
    this.reasons = reasons;
  }
}

/** Options for {@link username}. */
export interface UsernamePluginOptions extends AuthMethodOptions {
  /** Shared username credential store. */
  readonly usernames?: UsernameStore;
  /**
   * Username length / charset / character-class / shape policy
   * (defaults: 3–64 chars from `a-z0-9._-`, edge + consecutive symbols forbidden).
   */
  readonly usernamePolicy?: UsernamePolicyOptions;
  /**
   * Password length / character-class policy on sign-up.
   * Defaults to `gate.auth.passwordPolicy` when plugged after `oke()`,
   * else the same secure defaults (minLength 8, letter, number, upper, lower, symbol).
   */
  readonly passwordPolicy?: PasswordPolicyOptions;
  /**
   * Bun.password cost knobs. Defaults to `gate.auth.password`, else
   * `{ algorithm: "argon2id" }`.
   */
  readonly password?: PasswordHashOptions;
  /**
   * Optional breach check (`true` = reject). Defaults to
   * `gate.auth.breachCheck` when plugged after `oke()`.
   */
  readonly breachCheck?: BreachCheckFn;
}

const UsernameIn = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1),
});

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Merge base charset with extras, preserving first-seen order.
 *
 * @param base - Base allowed characters
 * @param extra - Optional characters to append
 */
function mergeAllowedChars(base: string, extra?: string): string {
  if (!extra || extra.length === 0) return base;
  const seen = new Set<string>();
  let out = "";
  for (const ch of base + extra) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

/**
 * Username + password sign-up / sign-in (`oke_usernames`).
 *
 * @param opts - Secret / session / store / policy overrides
 */
export function username(opts: UsernamePluginOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const active = getActiveGateAuthContext();
  const usernames = opts.usernames ?? createUsernameStore();
  const identities = resolveSharedIdentities(opts);
  const usernamePolicy = opts.usernamePolicy ?? {};
  const passwordPolicy = opts.passwordPolicy ?? active?.passwordPolicy ?? {};
  const passwordHash = opts.password ?? active?.password ?? { algorithm: "argon2id" };
  const breachCheck = opts.breachCheck ?? active?.breachCheck;
  // Resolve once at plug-time so bad config fails early.
  resolveUsernamePolicy(usernamePolicy);
  const crypto = createBunCrypto();

  const signUp = flow("auth.signUpUsername", {
    plane: "user",
    in: UsernameIn,
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const key = normalizeUsername(input.username);
      try {
        assertUsernamePolicy(key, usernamePolicy);
      } catch (err) {
        if (err instanceof UsernamePolicyError) {
          return fail("AuthFailed", {
            reason: "username_policy",
            reasons: [...err.reasons],
          });
        }
        throw err;
      }
      try {
        assertPasswordPolicy(input.password, passwordPolicy);
      } catch (err) {
        if (err instanceof PasswordPolicyError) {
          return fail("AuthFailed", {
            reason: "password_policy",
            reasons: [...err.reasons],
          });
        }
        throw err;
      }
      try {
        await assertNotBreached(input.password, breachCheck);
      } catch (err) {
        if (err instanceof BreachCheckError) {
          return fail("AuthFailed", { reason: "password_breached" });
        }
        throw err;
      }
      if (usernames.byUsername.has(key)) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const passwordHashValue = await crypto.hashPassword(input.password, passwordHash);
      let user: { id: string };
      try {
        user = (
          await linkOrProvision(identities, {
            provider: "username",
            providerAccountId: key,
            name: key,
            passwordHash: passwordHashValue,
            now: runtime.now,
          })
        ).user;
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        throw err;
      }
      const row: UsernameRow = {
        userId: user.id,
        username: key,
        passwordHash: passwordHashValue,
        createdAt: runtime.now(),
      };
      usernames.byUsername.set(key, row);
      usernames.byUserId.set(user.id, row);
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: user.id,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: user.id,
      };
    },
  });

  const signIn = flow("auth.signInUsername", {
    plane: "user",
    in: UsernameIn,
    out: SignInOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const key = normalizeUsername(input.username);
      const row = usernames.byUsername.get(key);
      const hash = row?.passwordHash ?? (await dummyHash(crypto));
      const ok = await crypto.verifyPassword(input.password, hash);
      if (!ok || !row) return fail("AuthFailed", { reason: "invalid_credentials" });
      const userId = row.userId;
      try {
        await linkOrProvision(identities, {
          provider: "username",
          providerAccountId: key,
          currentUserId: userId,
          now: runtime.now,
        });
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        throw err;
      }
      const bridge = getActiveGateAuthContext()?.twoFactor;
      if (bridge?.isEnabled(userId)) {
        const challenge = await bridge.beginLoginChallenge(userId);
        if (challenge) return challenge;
      }
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId,
      };
    },
  });

  return plugin("username", { version: "0.0.1", config: { method: "username" } })
    .needs("auth")
    .table("oke_usernames", undefined, { plane: "user", description: "Username credentials" })
    .binding(bindPublicAuth("/sign-up/username", signUp, "signUp"))
    .binding(bindPublicAuth("/sign-in/username", signIn, "signIn"));
}

let dummyPasswordHash: string | null = null;

async function dummyHash(crypto: ReturnType<typeof createBunCrypto>): Promise<string> {
  if (dummyPasswordHash === null) {
    dummyPasswordHash = await crypto.hashPassword("oke-username-timing-dummy", "argon2id");
  }
  return dummyPasswordHash;
}
