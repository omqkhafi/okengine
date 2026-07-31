/**
 * Passkey (WebAuthn-shaped) Gate auth method plugin — simplified v1 ceremony.
 *
 * Registration / authentication accept attestation-like payloads for tests
 * without a full WebAuthn library. Production should replace the ceremony
 * with a standards-compliant verifier.
 */

import {
  createVerificationStore,
  hashChallenge,
  putVerification,
  type VerificationStore,
} from "../auth/verification.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  AuthFailed,
  AuthRateLimited,
  SessionTokensOut,
  bindPublicAuth,
  bindSessionAuth,
  createMethodRuntime,
  fail,
  flow,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

/** Stored passkey credential (simplified). */
export interface PasskeyCredential {
  readonly credentialId: string;
  readonly userId: string;
  readonly publicKey: string;
  counter: number;
  readonly createdAt: number;
}

/** In-memory passkey store. */
export interface PasskeyStore {
  readonly byCredentialId: Map<string, PasskeyCredential>;
  readonly byUserId: Map<string, PasskeyCredential[]>;
}

/**
 * Create an empty passkey store.
 */
export function createPasskeyStore(): PasskeyStore {
  return { byCredentialId: new Map(), byUserId: new Map() };
}

/** Options for {@link passkey}. */
export interface PasskeyOptions extends AuthMethodOptions {
  readonly passkeys?: PasskeyStore;
  readonly challenges?: VerificationStore;
  /** Relying party id (default `localhost`). */
  readonly rpId?: string;
}

/**
 * Passkey register / authenticate options + simplified ceremony (`oke_passkeys`).
 *
 * @param opts - Stores / RP id
 */
export function passkey(opts: PasskeyOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const passkeys = opts.passkeys ?? createPasskeyStore();
  const challenges = opts.challenges ?? createVerificationStore();
  const rpId = opts.rpId ?? "localhost";

  const registerOptions = flow({
    name: "auth.passkeyRegisterOptions",
    unit: "auth",
    plane: "user",
    out: z.object({
      challenge: z.string(),
      rpId: z.string(),
      userId: z.string(),
    }),
    errors: { AuthFailed },
    do: async (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const challenge = crypto.randomUUID().replace(/-/g, "");
      const now = runtime.now();
      putVerification(challenges, {
        id: crypto.randomUUID(),
        identifier: `passkey-reg:${userId}`,
        value: await hashChallenge(challenge),
        expiresAt: now + 5 * 60 * 1000,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
      });
      return { challenge, rpId, userId };
    },
  });

  const register = flow({
    name: "auth.passkeyRegister",
    unit: "auth",
    plane: "user",
    in: z.object({
      credentialId: z.string().min(1),
      publicKey: z.string().min(1),
      userId: z.string().min(1),
      challenge: z.string().optional(),
    }),
    out: z.object({ ok: z.literal(true) }),
    errors: { AuthFailed },
    do: async (input, fx) => {
      const sessionUser = fx.auth.userId;
      if (!sessionUser || sessionUser !== input.userId) {
        return fail("AuthFailed", { reason: "unauthenticated" });
      }
      if (input.challenge) {
        const hash = await hashChallenge(input.challenge);
        const now = runtime.now();
        let found = false;
        for (const row of challenges.rows.values()) {
          if (row.identifier !== `passkey-reg:${input.userId}`) continue;
          if (row.consumedAt !== null || row.expiresAt <= now) continue;
          if (row.value === hash) {
            row.consumedAt = now;
            found = true;
            break;
          }
        }
        if (!found) return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      if (passkeys.byCredentialId.has(input.credentialId)) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const cred: PasskeyCredential = {
        credentialId: input.credentialId,
        userId: input.userId,
        publicKey: input.publicKey,
        counter: 0,
        createdAt: runtime.now(),
      };
      passkeys.byCredentialId.set(cred.credentialId, cred);
      const list = passkeys.byUserId.get(cred.userId) ?? [];
      list.push(cred);
      passkeys.byUserId.set(cred.userId, list);
      return { ok: true as const };
    },
  });

  const authenticateOptions = flow({
    name: "auth.passkeyAuthenticateOptions",
    unit: "auth",
    plane: "user",
    in: z.object({ email: z.string().optional() }),
    out: z.object({
      challenge: z.string(),
      rpId: z.string(),
      allowCredentials: z.array(z.string()),
    }),
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const challenge = crypto.randomUUID().replace(/-/g, "");
      const now = runtime.now();
      const key = input.email?.trim().toLowerCase() || "anonymous";
      putVerification(challenges, {
        id: crypto.randomUUID(),
        identifier: `passkey-auth:${key}`,
        value: await hashChallenge(challenge),
        expiresAt: now + 5 * 60 * 1000,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
      });
      // Simplified: empty allow list when no email mapping (caller supplies credentialId).
      return { challenge, rpId, allowCredentials: [] as string[] };
    },
  });

  const authenticate = flow({
    name: "auth.passkeyAuthenticate",
    unit: "auth",
    plane: "user",
    in: z.object({
      credentialId: z.string().min(1),
      userId: z.string().min(1),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      // Simplified v1: presence of stored credential + matching userId issues a session.
      const cred = passkeys.byCredentialId.get(input.credentialId);
      if (!cred || cred.userId !== input.userId) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      cred.counter += 1;
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: cred.userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: cred.userId,
      };
    },
  });

  return plugin("passkey", { version: "0.0.1", config: { method: "passkey" } })
    .needs("auth")
    .table("oke_passkeys", undefined, { plane: "user", description: "WebAuthn credentials" })
    .binding(bindSessionAuth("/passkey/register/options", registerOptions))
    .binding(bindSessionAuth("/passkey/register", register))
    .binding(bindPublicAuth("/passkey/authenticate/options", authenticateOptions, "otp"))
    .binding(bindPublicAuth("/passkey/authenticate", authenticate, "otp"));
}
