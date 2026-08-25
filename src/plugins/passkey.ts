/**
 * Passkey (WebAuthn) Gate auth method plugin.
 *
 * Registration and authentication verify clientDataJSON origin + challenge,
 * authenticatorData rpId hash, and ECDSA P-256 signature against the stored
 * SPKI public key. Presence-only authenticate is rejected.
 */

import { constantTimeEqual } from "../auth/constant-time.ts";
import { IdentityError, linkOrProvision } from "../auth/identity.ts";
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
  resolveSharedIdentities,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";
import { verifyWebAuthnCeremony } from "./passkey-webauthn.ts";

/** Stored passkey credential. */
export interface PasskeyCredential {
  readonly credentialId: string;
  readonly userId: string;
  /** Base64url SPKI public key (ECDSA P-256). */
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
  /**
   * Allowed `clientDataJSON.origin` values.
   * Default: `http://localhost` and `https://localhost`.
   */
  readonly origins?: readonly string[];
}

const CeremonyIn = z.object({
  credentialId: z.string().min(1),
  publicKey: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  challenge: z.string().min(1),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
});

/**
 * Passkey register / authenticate with cryptographic WebAuthn verify (`oke_passkeys`).
 *
 * @param opts - Stores / RP id / allowed origins
 */
export function passkey(opts: PasskeyOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = resolveSharedIdentities(opts);
  const passkeys = opts.passkeys ?? createPasskeyStore();
  const challenges = opts.challenges ?? createVerificationStore();
  const rpId = opts.rpId ?? "localhost";
  const origins = opts.origins ?? ["http://localhost", "https://localhost"];

  const registerOptions = flow("auth.passkeyRegisterOptions", {
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

  const register = flow("auth.passkeyRegister", {
    plane: "user",
    in: CeremonyIn.extend({
      publicKey: z.string().min(1),
      userId: z.string().min(1),
    }),
    out: z.object({ ok: z.literal(true) }),
    errors: { AuthFailed },
    do: async (input, fx) => {
      const sessionUser = fx.auth.userId;
      if (!sessionUser || sessionUser !== input.userId) {
        return fail("AuthFailed", { reason: "unauthenticated" });
      }
      const consumed = await consumeChallenge(
        challenges,
        `passkey-reg:${input.userId}`,
        input.challenge,
        runtime.now(),
      );
      if (!consumed) return fail("AuthFailed", { reason: "invalid_credentials" });

      const verified = await verifyWebAuthnCeremony({
        expectedType: "webauthn.create",
        expectedChallenge: input.challenge,
        expectedOrigins: origins,
        rpId,
        publicKeySpkiB64url: input.publicKey,
        clientDataJSON: input.clientDataJSON,
        authenticatorData: input.authenticatorData,
        signature: input.signature,
      });
      if (!verified.ok) {
        return fail("AuthFailed", {
          reason: verified.reason === "invalid_origin" ? "invalid_origin" : "invalid_credentials",
        });
      }
      if (passkeys.byCredentialId.has(input.credentialId)) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      let userId: string;
      try {
        userId = (
          await linkOrProvision(identities, {
            provider: "passkey",
            providerAccountId: input.credentialId,
            currentUserId: sessionUser,
            now: runtime.now,
          })
        ).user.id;
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        throw err;
      }
      const cred: PasskeyCredential = {
        credentialId: input.credentialId,
        userId,
        publicKey: input.publicKey,
        counter: verified.signCount,
        createdAt: runtime.now(),
      };
      passkeys.byCredentialId.set(cred.credentialId, cred);
      const list = passkeys.byUserId.get(cred.userId) ?? [];
      list.push(cred);
      passkeys.byUserId.set(cred.userId, list);
      return { ok: true as const };
    },
  });

  const authenticateOptions = flow("auth.passkeyAuthenticateOptions", {
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
      return { challenge, rpId, allowCredentials: [] as string[] };
    },
  });

  const authenticate = flow("auth.passkeyAuthenticate", {
    plane: "user",
    in: CeremonyIn.extend({
      challenge: z.string().min(1),
      /** Challenge bucket key from authenticate options (default `anonymous`). */
      email: z.string().optional(),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const cred = passkeys.byCredentialId.get(input.credentialId);
      if (!cred) return fail("AuthFailed", { reason: "invalid_credentials" });

      const bucket = input.email?.trim().toLowerCase() || "anonymous";
      const consumed = await consumeChallenge(
        challenges,
        `passkey-auth:${bucket}`,
        input.challenge,
        runtime.now(),
      );
      if (!consumed) return fail("AuthFailed", { reason: "invalid_credentials" });

      const verified = await verifyWebAuthnCeremony({
        expectedType: "webauthn.get",
        expectedChallenge: input.challenge,
        expectedOrigins: origins,
        rpId,
        publicKeySpkiB64url: cred.publicKey,
        clientDataJSON: input.clientDataJSON,
        authenticatorData: input.authenticatorData,
        signature: input.signature,
        previousSignCount: cred.counter,
      });
      if (!verified.ok) {
        return fail("AuthFailed", {
          reason: verified.reason === "invalid_origin" ? "invalid_origin" : "invalid_credentials",
        });
      }
      cred.counter = verified.signCount;

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

async function consumeChallenge(
  store: VerificationStore,
  identifier: string,
  challenge: string,
  now: number,
): Promise<boolean> {
  const hash = await hashChallenge(challenge);
  for (const row of store.rows.values()) {
    if (row.identifier !== identifier) continue;
    if (row.consumedAt !== null || row.expiresAt <= now) continue;
    if (!constantTimeEqual(row.value, hash)) continue;
    row.consumedAt = now;
    return true;
  }
  return false;
}
