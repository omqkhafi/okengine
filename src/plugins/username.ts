/**
 * Username + password Gate auth method plugin.
 */

import { createBunCrypto } from "../runtime/primitives.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  AuthFailed,
  AuthRateLimited,
  SessionTokensOut,
  bindPublicAuth,
  createMethodRuntime,
  fail,
  flow,
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

/** Options for {@link username}. */
export interface UsernamePluginOptions extends AuthMethodOptions {
  /** Shared username credential store. */
  readonly usernames?: UsernameStore;
}

const UsernameIn = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(1),
});

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Username + password sign-up / sign-in (`oke_usernames`).
 *
 * @param opts - Secret / session / store overrides
 */
export function username(opts: UsernamePluginOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const usernames = opts.usernames ?? createUsernameStore();
  const crypto = createBunCrypto();

  const signUp = flow({
    name: "auth.signUpUsername",
    unit: "auth",
    plane: "user",
    in: UsernameIn,
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const key = normalizeUsername(input.username);
      if (!/^[a-z0-9._-]{3,64}$/.test(key)) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      if (usernames.byUsername.has(key)) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const userId = crypto.randomUUID();
      const passwordHash = await crypto.hashPassword(input.password, {
        algorithm: "argon2id",
      });
      const row: UsernameRow = {
        userId,
        username: key,
        passwordHash,
        createdAt: runtime.now(),
      };
      usernames.byUsername.set(key, row);
      usernames.byUserId.set(userId, row);
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

  const signIn = flow({
    name: "auth.signInUsername",
    unit: "auth",
    plane: "user",
    in: UsernameIn,
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const key = normalizeUsername(input.username);
      const row = usernames.byUsername.get(key);
      const hash = row?.passwordHash ?? (await dummyHash(crypto));
      const ok = await crypto.verifyPassword(input.password, hash);
      if (!ok || !row) return fail("AuthFailed", { reason: "invalid_credentials" });
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: row.userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: row.userId,
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
