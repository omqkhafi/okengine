/**
 * Magic-link Gate auth method plugin.
 *
 * Delivers the one-time token via Channel (`fx.send` + `auth-magic-link`
 * template). {@link MagicLinkOptions.exposeDevToken} remains available for
 * local DX without Mailpit / SMTP.
 */

import { linkOrProvision, normalizeEmail, type IdentityStore } from "../auth/identity.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import {
  createVerificationStore,
  hashChallenge,
  putVerification,
  type VerificationStore,
} from "../auth/verification.ts";
import { channel } from "../elements/channel.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  AuthFailed,
  AuthRateLimited,
  SessionTokensOut,
  bindPublicAuth,
  createMethodRuntime,
  fail,
  flow,
  resolveSharedIdentities,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FROM = "OKE <no-reply@oke.local>";
const DEFAULT_BASE_URL = "http://127.0.0.1:6530";

/** Channel template for magic-link delivery. */
export const magicLinkTemplate = channel.email({ from: DEFAULT_FROM }).template("auth-magic-link", {
  description: "Magic-link sign-in email",
  schema: z.object({
    email: z.string(),
    token: z.string(),
    link: z.string(),
  }),
  locales: ["en", "ar"],
});

/** Default EN/AR bodies for {@link magicLinkTemplate}. */
export const magicLinkCatalog = {
  "auth-magic-link": {
    en: {
      subject: "Your sign-in link",
      text: "Sign in with this link:\n{{link}}\n\nOr enter this token:\n{{token}}\n",
      html: '<p>Sign in with this link:</p><p><a href="{{link}}">{{link}}</a></p><p>Or enter this token:</p><p><code>{{token}}</code></p>',
    },
    ar: {
      subject: "رابط تسجيل الدخول",
      text: "سجّل الدخول عبر هذا الرابط:\n{{link}}\n\nأو أدخل هذا الرمز:\n{{token}}\n",
      html: '<p dir="rtl">سجّل الدخول عبر هذا الرابط:</p><p dir="rtl"><a href="{{link}}">{{link}}</a></p><p dir="rtl">أو أدخل هذا الرمز:</p><p dir="rtl"><code>{{token}}</code></p>',
    },
  },
} as const;

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
  /**
   * App origin used to build the magic link (default `OKE_APP_URL` or
   * `http://127.0.0.1:6530`).
   */
  readonly baseUrl?: string;
  /** Override the template `from` address. */
  readonly from?: string;
}

/**
 * Magic-link request + verify (`oke_verifications` challenge rows).
 *
 * @param opts - TTL / stores / dev token
 */
export function magicLink(opts: MagicLinkOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = resolveSharedIdentities(opts);
  const verifications = opts.verifications ?? createVerificationStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const baseUrl = (opts.baseUrl ?? process.env.OKE_APP_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const tmpl =
    opts.from !== undefined
      ? channel.email({ from: opts.from }).template("auth-magic-link", {
          description: "Magic-link sign-in email",
          schema: z.object({
            email: z.string(),
            token: z.string(),
            link: z.string(),
          }),
          locales: ["en", "ar"],
        })
      : magicLinkTemplate;

  const request = flow("auth.requestMagicLink", {
    plane: "user",
    in: z.object({ email: z.string().min(3) }),
    out: z.object({
      ok: z.literal(true),
      devToken: z.string().optional(),
    }),
    errors: { AuthFailed, AuthRateLimited },
    effects: { sends: ["auth-magic-link"] },
    do: async (input, fx) => {
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
      const link = `${baseUrl}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
      await fx.send(tmpl, {
        to: email,
        data: { email, token, link },
      });
      return {
        ok: true as const,
        ...(opts.exposeDevToken ? { devToken: token } : {}),
      };
    },
  });

  const verify = flow("auth.verifyMagicLink", {
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
      const { user } = await linkOrProvision(identities, {
        provider: "magic-link",
        providerAccountId: email,
        email,
        emailVerified: true,
        now: () => now,
      });
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
    .needs("channel")
    .channelTemplate(tmpl)
    .channelCatalog(magicLinkCatalog)
    .binding(bindPublicAuth("/magic-link/request", request, "otp"))
    .binding(bindPublicAuth("/magic-link/verify", verify, "otp"));
}
