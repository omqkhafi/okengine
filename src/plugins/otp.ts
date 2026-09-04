/**
 * Unified OTP Gate auth method plugin — provider mode (Verify) or app mode
 * (multi-channel). Replaces emailOtp() + phoneNumber().
 */

import { constantTimeEqual } from "../auth/constant-time.ts";
import {
  completeVerifiedEmailSignIn,
  IdentityError,
  linkOrProvision,
  normalizeEmail,
  type IdentityStore,
  type UserIdentityRow,
} from "../auth/identity.ts";
import type { OtpPluginConfig } from "../auth/otp-capability.ts";
import { sealOtp, unsealOtp } from "../auth/otp-seal.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import {
  consumeVerification,
  createVerificationStore,
  findActiveVerification,
  generateOtp,
  hashChallenge,
  invalidateVerifications,
  putVerification,
  type OtpChannel,
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
  resolveMethodSecret,
  resolveSharedIdentities,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

const E164 = /^\+[1-9]\d{7,14}$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
const DEFAULT_FROM = "OKE <no-reply@oke.local>";
const OTP_CHANNELS = ["sms", "whatsapp", "email"] as const;

/** Phone principal store (phone → userId). */
export interface PhoneStore {
  readonly byPhone: Map<string, string>;
}

/**
 * Create an empty phone → user map.
 */
export function createPhoneStore(): PhoneStore {
  return { byPhone: new Map() };
}

/** Shared base options. */
interface OtpBaseOptions extends AuthMethodOptions {
  readonly ttlMs?: number;
  readonly verifications?: VerificationStore;
  readonly phones?: PhoneStore;
  readonly identities?: IdentityStore;
}

/** Provider mode — provider-owned OTP via fx.sendOtp / fx.verifyOtp. */
export interface OtpProviderModeOptions extends OtpBaseOptions {
  readonly mode: "provider";
  /** Forbidden in provider mode — fail loud if set. */
  readonly channels?: never;
  /** Forbidden in provider mode — code never exists server-side. */
  readonly exposeDevOtp?: never;
  readonly resendCooldownMs?: never;
  readonly from?: never;
}

/** App mode — app-owned OTP with multi-channel delivery. */
export interface OtpAppModeOptions extends OtpBaseOptions {
  readonly mode: "app";
  /** Build-time preferred channel order (required). */
  readonly channels: readonly OtpChannel[];
  readonly resendCooldownMs?: number;
  readonly exposeDevOtp?: boolean;
  readonly from?: string;
}

/** Options for {@link otp}. `mode` is mandatory — no auto-detect. */
export type OtpOptions = OtpProviderModeOptions | OtpAppModeOptions;

/** Email OTP template (app mode). */
export const otpEmailTemplate = channel.email({ from: DEFAULT_FROM }).template("auth-otp-email", {
  description: "OTP sign-in code (email)",
  schema: z.object({ email: z.string(), otp: z.string() }),
  locales: ["en", "ar"],
});

/** SMS OTP template (app mode — plain message, not provider Verify). */
export const otpSmsTemplate = channel.sms().template("auth-otp-sms", {
  description: "OTP sign-in code (SMS)",
  schema: z.object({ phone: z.string(), otp: z.string() }),
  locales: ["en", "ar"],
});

/** WhatsApp OTP template (app mode). */
export const otpWhatsappTemplate = channel.whatsapp().template("auth-otp-whatsapp", {
  description: "OTP sign-in code (WhatsApp)",
  schema: z.object({ phone: z.string(), otp: z.string() }),
  locales: ["en", "ar"],
});

/** Default EN/AR bodies for OTP templates. */
export const otpCatalog = {
  "auth-otp-email": {
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
  "auth-otp-sms": {
    en: { text: "Your sign-in code is: {{otp}}" },
    ar: { text: "رمز تسجيل الدخول: {{otp}}" },
  },
  "auth-otp-whatsapp": {
    en: { text: "Your sign-in code is: {{otp}}" },
    ar: { text: "رمز تسجيل الدخول: {{otp}}" },
  },
} as const;

function assertOtpOptions(opts: OtpOptions): void {
  if (opts.mode !== "provider" && opts.mode !== "app") {
    throw new Error(
      'otp(): mode is required — set mode: "provider" or mode: "app" (no auto-detect)',
    );
  }
  if (opts.mode === "provider") {
    if ("channels" in opts && opts.channels !== undefined) {
      throw new Error(
        'otp({ mode: "provider" }): channels are forbidden — provider-owned OTP cannot resend via a different channel; use mode: "app" for multi-channel',
      );
    }
    if ("exposeDevOtp" in opts && (opts as { exposeDevOtp?: boolean }).exposeDevOtp === true) {
      throw new Error(
        'otp({ mode: "provider" }): exposeDevOtp is forbidden — the code never exists server-side',
      );
    }
    return;
  }
  const channels = opts.channels;
  if (!channels || channels.length === 0) {
    throw new Error(
      'otp({ mode: "app" }): channels is required — declare at least one of "sms" | "whatsapp" | "email"',
    );
  }
  for (const ch of channels) {
    if (!(OTP_CHANNELS as readonly string[]).includes(ch)) {
      throw new Error(`otp({ mode: "app" }): unknown channel "${String(ch)}"`);
    }
  }
}

function principalKey(phone: string | undefined, email: string | undefined): string | undefined {
  if (phone) return phone;
  if (email) return email;
  return undefined;
}

function pickRequestChannel(
  channels: readonly OtpChannel[],
  phone: string | undefined,
  email: string | undefined,
  override: OtpChannel | undefined,
): OtpChannel | undefined {
  const order = override ? [override, ...channels.filter((c) => c !== override)] : channels;
  for (const ch of order) {
    if (ch === "email" && email) return ch;
    if ((ch === "sms" || ch === "whatsapp") && phone) return ch;
  }
  return undefined;
}

/**
 * Unified OTP request + verify (+ app-mode resend).
 *
 * @param opts - Must include `mode: "provider"` or `mode: "app"`
 */
export function otp(opts: OtpOptions): PluginDef {
  assertOtpOptions(opts);

  const runtime = createMethodRuntime(opts);
  const secret = resolveMethodSecret(opts);
  const phones = opts.phones ?? createPhoneStore();
  const identities = resolveSharedIdentities(opts);
  const verifications = opts.verifications ?? createVerificationStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const resendCooldownMs =
    opts.mode === "app"
      ? (opts.resendCooldownMs ?? DEFAULT_RESEND_COOLDOWN_MS)
      : DEFAULT_RESEND_COOLDOWN_MS;
  const channels = opts.mode === "app" ? opts.channels : ([] as const);
  const exposeDevOtp = opts.mode === "app" && opts.exposeDevOtp === true;
  const from = opts.mode === "app" ? opts.from : undefined;

  const emailTmpl =
    from !== undefined
      ? channel.email({ from }).template("auth-otp-email", {
          description: "OTP sign-in code (email)",
          schema: z.object({ email: z.string(), otp: z.string() }),
          locales: ["en", "ar"],
        })
      : otpEmailTemplate;

  const templates = {
    email: emailTmpl.name,
    sms: otpSmsTemplate.name,
    whatsapp: otpWhatsappTemplate.name,
  } as const;

  const configSnapshot: OtpPluginConfig =
    opts.mode === "provider"
      ? { method: "otp", mode: "provider" }
      : { method: "otp", mode: "app", channels: [...channels] };

  const requestOut = z.object({
    ok: z.literal(true),
    devOtp: z.string().optional(),
    channel: z.enum(["sms", "whatsapp", "email"]).optional(),
  });

  if (opts.mode === "provider") {
    const request = flow("auth.requestOtp", {
      plane: "user",
      in: z.object({
        phone: z.string().min(8),
        lang: z.enum(["en", "ar"]).optional(),
      }),
      out: requestOut,
      errors: { AuthFailed, AuthRateLimited },
      effects: { sends: ["sms-otp"] },
      do: async (input, fx) => {
        const phone = input.phone.trim();
        if (!E164.test(phone)) return fail("AuthFailed", { reason: "invalid_phone" });
        const now = runtime.now();
        const identifier = `otp:${phone}`;
        invalidateVerifications(verifications, identifier, now);

        const requestId = crypto.randomUUID();
        await fx.sendOtp({
          to: phone,
          requestId,
          ...(input.lang ? { lang: input.lang } : {}),
        });

        putVerification(verifications, {
          id: crypto.randomUUID(),
          identifier,
          value: `provider:${requestId}`,
          expiresAt: now + ttlMs,
          createdAt: now,
          consumedAt: null,
          attempts: 0,
          phone,
          sealedOtp: null,
        });
        // Provider mode: resend-via-different-channel is impossible — provider owns the code.
        return { ok: true as const, channel: "sms" as const };
      },
    });

    const verify = flow("auth.verifyOtp", {
      plane: "user",
      in: z.object({
        phone: z.string().min(8),
        otp: z.string().min(4).max(8),
        lang: z.enum(["en", "ar"]).optional(),
      }),
      out: SessionTokensOut,
      errors: { AuthFailed, AuthRateLimited },
      effects: { sends: ["sms-otp"] },
      do: async (input, fx) => {
        const phone = input.phone.trim();
        if (!E164.test(phone)) return fail("AuthFailed", { reason: "invalid_phone" });
        const now = runtime.now();
        const row = findActiveVerification(verifications, `otp:${phone}`, now);
        if (!row) return fail("AuthFailed", { reason: "invalid_credentials" });
        if (row.attempts >= MAX_ATTEMPTS) {
          consumeVerification(row, now);
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }

        const prefix = row.value.startsWith("provider:")
          ? "provider:"
          : row.value.startsWith("taqnyat:")
            ? "taqnyat:"
            : null;
        if (!prefix) return fail("AuthFailed", { reason: "invalid_credentials" });
        const requestId = row.value.slice(prefix.length);
        try {
          await fx.verifyOtp({
            to: phone,
            requestId,
            code: input.otp.trim(),
            ...(input.lang ? { lang: input.lang } : {}),
          });
        } catch {
          row.attempts += 1;
          if (row.attempts >= MAX_ATTEMPTS) consumeVerification(row, now);
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        consumeVerification(row, now);

        let userId = phones.byPhone.get(phone);
        if (!userId) {
          try {
            const { user } = await linkOrProvision(identities, {
              provider: "otp",
              providerAccountId: phone,
              now: () => now,
            });
            userId = user.id;
          } catch (err) {
            if (err instanceof IdentityError) {
              return fail("AuthFailed", { reason: "invalid_credentials" });
            }
            throw err;
          }
          phones.byPhone.set(phone, userId);
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

    return plugin("otp", { version: "0.0.1", config: configSnapshot })
      .needs("auth")
      .binding(bindPublicAuth("/otp/request", request, "otp"))
      .binding(bindPublicAuth("/otp/verify", verify, "otp"));
  }

  // ── App mode ───────────────────────────────────────────────────────────
  const request = flow("auth.requestOtp", {
    plane: "user",
    in: z.object({
      email: z.string().min(3).optional(),
      phone: z.string().min(8).optional(),
      channel: z.enum(["sms", "whatsapp", "email"]).optional(),
      lang: z.enum(["en", "ar"]).optional(),
    }),
    out: requestOut,
    errors: { AuthFailed, AuthRateLimited },
    effects: { sends: ["auth-otp", "auth-otp-email", "auth-otp-sms", "auth-otp-whatsapp"] },
    do: async (input, fx) => {
      const email = input.email ? normalizeEmail(input.email) : undefined;
      const phone = input.phone?.trim();
      if (email !== undefined && !email.includes("@")) {
        return fail("AuthFailed", { reason: "invalid_email" });
      }
      if (phone !== undefined && !E164.test(phone)) {
        return fail("AuthFailed", { reason: "invalid_phone" });
      }
      const principal = principalKey(phone, email);
      if (!principal) return fail("AuthFailed", { reason: "invalid_credentials" });

      const deliverChannel = pickRequestChannel(channels, phone, email, input.channel);
      if (!deliverChannel) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }

      const otpCode = generateOtp(6);
      const now = runtime.now();
      const identifier = `otp:${principal}`;
      invalidateVerifications(verifications, identifier, now);

      const sealed = await sealOtp(secret, otpCode);
      putVerification(verifications, {
        id: crypto.randomUUID(),
        identifier,
        value: await hashChallenge(otpCode),
        expiresAt: now + ttlMs,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
        sealedOtp: sealed,
        lastDeliveredAt: now,
        lastChannel: deliverChannel,
        email: email ?? null,
        phone: phone ?? null,
      });

      const delivered = await fx.deliverOtp({
        channels: [...channels],
        templates,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        data: { otp: otpCode, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
        ...(input.lang ? { locale: input.lang } : {}),
      });

      return {
        ok: true as const,
        channel: delivered.channel,
        ...(exposeDevOtp ? { devOtp: otpCode } : {}),
      };
    },
  });

  const resend = flow("auth.resendOtp", {
    plane: "user",
    in: z.object({
      email: z.string().min(3).optional(),
      phone: z.string().min(8).optional(),
      channel: z.enum(["sms", "whatsapp", "email"]),
      lang: z.enum(["en", "ar"]).optional(),
    }),
    out: requestOut,
    errors: { AuthFailed, AuthRateLimited },
    effects: { sends: ["auth-otp", "auth-otp-email", "auth-otp-sms", "auth-otp-whatsapp"] },
    do: async (input, fx) => {
      const email = input.email ? normalizeEmail(input.email) : undefined;
      const phone = input.phone?.trim();
      if (email !== undefined && !email.includes("@")) {
        return fail("AuthFailed", { reason: "invalid_email" });
      }
      if (phone !== undefined && !E164.test(phone)) {
        return fail("AuthFailed", { reason: "invalid_phone" });
      }
      const principal = principalKey(phone, email);
      if (!principal) return fail("AuthFailed", { reason: "invalid_credentials" });

      const now = runtime.now();
      const row = findActiveVerification(verifications, `otp:${principal}`, now);
      if (!row || !row.sealedOtp) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      if (row.lastDeliveredAt !== undefined && now - row.lastDeliveredAt < resendCooldownMs) {
        return fail("AuthFailed", { reason: "resend_cooldown" });
      }

      const targetEmail = email ?? row.email ?? undefined;
      const targetPhone = phone ?? row.phone ?? undefined;
      if (input.channel === "email" && !targetEmail) {
        return fail("AuthFailed", { reason: "invalid_email" });
      }
      if ((input.channel === "sms" || input.channel === "whatsapp") && !targetPhone) {
        return fail("AuthFailed", { reason: "invalid_phone" });
      }

      const otpCode = await unsealOtp(secret, row.sealedOtp);
      const delivered = await fx.deliverOtp({
        channels: [...channels],
        templates,
        ...(targetEmail ? { email: targetEmail } : {}),
        ...(targetPhone ? { phone: targetPhone } : {}),
        data: {
          otp: otpCode,
          ...(targetEmail ? { email: targetEmail } : {}),
          ...(targetPhone ? { phone: targetPhone } : {}),
        },
        ...(input.lang ? { locale: input.lang } : {}),
        only: input.channel,
      });

      row.lastDeliveredAt = now;
      row.lastChannel = delivered.channel;
      if (targetEmail) row.email = targetEmail;
      if (targetPhone) row.phone = targetPhone;

      return {
        ok: true as const,
        channel: delivered.channel,
        ...(exposeDevOtp ? { devOtp: otpCode } : {}),
      };
    },
  });

  const verify = flow("auth.verifyOtp", {
    plane: "user",
    in: z.object({
      email: z.string().min(3).optional(),
      phone: z.string().min(8).optional(),
      otp: z.string().min(4).max(8),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const email = input.email ? normalizeEmail(input.email) : undefined;
      const phone = input.phone?.trim();
      if (email !== undefined && !email.includes("@")) {
        return fail("AuthFailed", { reason: "invalid_email" });
      }
      if (phone !== undefined && !E164.test(phone)) {
        return fail("AuthFailed", { reason: "invalid_phone" });
      }
      const principal = principalKey(phone, email);
      if (!principal) return fail("AuthFailed", { reason: "invalid_credentials" });

      const now = runtime.now();
      const row = findActiveVerification(verifications, `otp:${principal}`, now);
      if (!row) return fail("AuthFailed", { reason: "invalid_credentials" });
      if (row.attempts >= MAX_ATTEMPTS) {
        consumeVerification(row, now);
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }

      const hash = await hashChallenge(input.otp.trim());
      if (!constantTimeEqual(hash, row.value)) {
        row.attempts += 1;
        if (row.attempts >= MAX_ATTEMPTS) consumeVerification(row, now);
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      consumeVerification(row, now);

      if (phone) {
        let userId = phones.byPhone.get(phone);
        if (!userId) {
          try {
            const { user } = await linkOrProvision(identities, {
              provider: "otp",
              providerAccountId: phone,
              now: () => now,
            });
            userId = user.id;
          } catch (err) {
            if (err instanceof IdentityError) {
              return fail("AuthFailed", { reason: "invalid_credentials" });
            }
            throw err;
          }
          phones.byPhone.set(phone, userId);
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
      }

      let user: UserIdentityRow;
      try {
        user = (
          await completeVerifiedEmailSignIn(identities, runtime.sessions, {
            provider: "otp",
            providerAccountId: email!,
            email: email!,
            now: () => now,
          })
        ).user;
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        throw err;
      }
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

  return plugin("otp", { version: "0.0.1", config: configSnapshot })
    .needs("auth")
    .needs("channel")
    .channelTemplate(emailTmpl)
    .channelTemplate(otpSmsTemplate)
    .channelTemplate(otpWhatsappTemplate)
    .channelCatalog(otpCatalog)
    .binding(bindPublicAuth("/otp/request", request, "otp"))
    .binding(bindPublicAuth("/otp/verify", verify, "otp"))
    .binding(bindPublicAuth("/otp/resend", resend, "otp"));
}
