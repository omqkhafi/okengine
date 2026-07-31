/**
 * Magic-link Gate auth method plugin.
 *
 * Delivery via Channel is optional in v1 — when {@link MagicLinkOptions.exposeDevToken}
 * is set, the request response includes `devToken` for tests / local DX.
 */

import {
  createIdentityStore,
  normalizeEmail,
  type IdentityStore,
  type UserIdentityRow,
} from "../auth/identity.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import {
  createVerificationStore,
  hashChallenge,
  putVerification,
  type VerificationStore,
} from "../auth/verification.ts";
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

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Options for {@link magicLink}. */
export interface MagicLinkOptions extends AuthMethodOptions {
  /** Challenge TTL (default 10m). */
  readonly ttlMs?: number;
  /** Identity store for email → user. */
  readonly identities?: IdentityStore;
  /** Verification / challenge store. */
  readonly verifications?: VerificationStore;
  /** Return raw token in the request response (test / local). */
  readonly exposeDevToken?: boolean;
}

/**
 * Magic-link request + verify (`oke_verifications` challenge rows).
 *
 * @param opts - TTL / stores / dev token
 */
export function magicLink(opts: MagicLinkOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = opts.identities ?? createIdentityStore();
  const verifications = opts.verifications ?? createVerificationStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  const request = flow({
    name: "auth.requestMagicLink",
    unit: "auth",
    plane: "user",
    in: z.object({ email: z.string().min(3) }),
    out: z.object({
      ok: z.literal(true),
      devToken: z.string().optional(),
    }),
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const email = normalizeEmail(input.email);
      if (!email.includes("@")) return fail("AuthFailed", { reason: "invalid_email" });
      const token = `ml_${crypto.randomUUID().replace(/-/g, "")}`;
      const now = runtime.now();
      putVerification(verifications, {
        id: crypto.randomUUID(),
        identifier: `magic:${email}`,
        value: await hashChallenge(token),
        expiresAt: now + ttlMs,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
      });
      return {
        ok: true as const,
        ...(opts.exposeDevToken ? { devToken: token } : {}),
      };
    },
  });

  const verify = flow({
    name: "auth.verifyMagicLink",
    unit: "auth",
    plane: "user",
    in: z.object({ token: z.string().min(1) }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const hash = await hashChallenge(input.token);
      const now = runtime.now();
      let row:
        | {
            id: string;
            identifier: string;
            value: string;
            expiresAt: number;
            consumedAt: number | null;
            attempts: number;
          }
        | undefined;
      for (const candidate of verifications.rows.values()) {
        if (!candidate.identifier.startsWith("magic:")) continue;
        if (candidate.consumedAt !== null) continue;
        if (candidate.expiresAt <= now) continue;
        if (candidate.value === hash) {
          row = candidate;
          break;
        }
      }
      if (!row) return fail("AuthFailed", { reason: "invalid_credentials" });
      row.consumedAt = now;
      const email = row.identifier.slice("magic:".length);
      const user = ensureUserByEmail(identities, email, now);
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

  return plugin("magicLink", { version: "0.0.1", config: { method: "magic-link" } })
    .needs("auth")
    .binding(bindPublicAuth("/magic-link/request", request, "otp"))
    .binding(bindPublicAuth("/magic-link/verify", verify, "otp"));
}

function ensureUserByEmail(store: IdentityStore, email: string, now: number): UserIdentityRow {
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
