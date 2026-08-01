/**
 * Email OTP Gate auth method plugin.
 *
 * Delivers the one-time code via Channel (`fx.send` + `auth-email-otp`
 * template). {@link EmailOtpOptions.exposeDevOtp} remains available for
 * local DX without Mailpit / SMTP.
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
  findActiveVerification,
  generateOtp,
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
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const DEFAULT_FROM = "OKE <no-reply@oke.local>";

/** Channel template for email OTP delivery. */
export const emailOtpTemplate = channel.email({ from: DEFAULT_FROM }).template("auth-email-otp", {
  description: "Email OTP sign-in code",
  schema: z.object({
    email: z.string(),
    otp: z.string(),
  }),
  locales: ["en", "ar"],
});

/** Default EN/AR bodies for {@link emailOtpTemplate}. */
export const emailOtpCatalog = {
  "auth-email-otp": {
    en: {
      subject: "Your sign-in code",
      text: "Your one-time sign-in code is: {{otp}}\n",
      html: "<p>Your one-time sign-in code is:</p><p><strong>{{otp}}</strong></p>",
    },
    ar: {
      subject: "رمز تسجيل الدخول",
      text: "رمز تسجيل الدخول لمرة واحدة هو: {{otp}}\n",
      html: '<p dir="rtl">رمز تسجيل الدخول لمرة واحدة هو:</p><p dir="rtl"><strong>{{otp}}</strong></p>',
    },
  },
} as const;

/** Options for {@link emailOtp}. */
export interface EmailOtpOptions extends AuthMethodOptions {
  /** Challenge TTL (default 10m). */
  readonly ttlMs?: number;
  readonly identities?: IdentityStore;
  readonly verifications?: VerificationStore;
  /** Return raw OTP in the request response (test / local). */
  readonly exposeDevOtp?: boolean;
  /** Override the template `from` address. */
  readonly from?: string;
}

/**
 * Email OTP request + verify (6-digit, hashed, 5 attempts).
 *
 * @param opts - TTL / stores / dev OTP
 */
export function emailOtp(opts: EmailOtpOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = opts.identities ?? createIdentityStore();
  const verifications = opts.verifications ?? createVerificationStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const tmpl =
    opts.from !== undefined
      ? channel.email({ from: opts.from }).template("auth-email-otp", {
          description: "Email OTP sign-in code",
          schema: z.object({
            email: z.string(),
            otp: z.string(),
          }),
          locales: ["en", "ar"],
        })
      : emailOtpTemplate;

  const request = flow({
    name: "auth.requestEmailOtp",
    unit: "auth",
    plane: "user",
    in: z.object({ email: z.string().min(3) }),
    out: z.object({
      ok: z.literal(true),
      devOtp: z.string().optional(),
    }),
    errors: { AuthFailed, AuthRateLimited },
    effects: { sends: ["auth-email-otp"] },
    do: async (input, fx) => {
      const email = normalizeEmail(input.email);
      if (!email.includes("@")) return fail("AuthFailed", { reason: "invalid_email" });
      const otp = generateOtp(6);
      const now = runtime.now();
      // Invalidate prior active challenges for this email.
      for (const row of verifications.rows.values()) {
        if (row.identifier === `email-otp:${email}` && row.consumedAt === null) {
          row.consumedAt = now;
        }
      }
      putVerification(verifications, {
        id: crypto.randomUUID(),
        identifier: `email-otp:${email}`,
        value: await hashChallenge(otp),
        expiresAt: now + ttlMs,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
      });
      await fx.send(tmpl, {
        to: email,
        data: { email, otp },
      });
      return {
        ok: true as const,
        ...(opts.exposeDevOtp ? { devOtp: otp } : {}),
      };
    },
  });

  const verify = flow({
    name: "auth.verifyEmailOtp",
    unit: "auth",
    plane: "user",
    in: z.object({
      email: z.string().min(3),
      otp: z.string().min(4).max(8),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const email = normalizeEmail(input.email);
      const now = runtime.now();
      const row = findActiveVerification(verifications, `email-otp:${email}`, now);
      if (!row) return fail("AuthFailed", { reason: "invalid_credentials" });
      if (row.attempts >= MAX_ATTEMPTS) {
        row.consumedAt = now;
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const hash = await hashChallenge(input.otp.trim());
      if (hash !== row.value) {
        row.attempts += 1;
        if (row.attempts >= MAX_ATTEMPTS) row.consumedAt = now;
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      row.consumedAt = now;
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

  return plugin("emailOtp", { version: "0.0.1", config: { method: "email-otp" } })
    .needs("auth")
    .needs("channel")
    .channelTemplate(tmpl)
    .channelCatalog(emailOtpCatalog)
    .binding(bindPublicAuth("/email-otp/request", request, "otp"))
    .binding(bindPublicAuth("/email-otp/verify", verify, "otp"));
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
