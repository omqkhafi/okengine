/**
 * Phone-number OTP Gate auth method plugin (E.164).
 */

import { issueSessionWithScopes } from "../auth/sessions.ts";
import {
  createVerificationStore,
  findActiveVerification,
  generateOtp,
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

const E164 = /^\+[1-9]\d{7,14}$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

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

/** Options for {@link phoneNumber}. */
export interface PhoneNumberOptions extends AuthMethodOptions {
  readonly ttlMs?: number;
  readonly phones?: PhoneStore;
  readonly verifications?: VerificationStore;
  /** Return raw OTP in the request response (test / local). */
  readonly exposeDevOtp?: boolean;
}

/**
 * Phone OTP request + verify (E.164, 6-digit, hashed, 5 attempts).
 *
 * @param opts - TTL / stores / dev OTP
 */
export function phoneNumber(opts: PhoneNumberOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const phones = opts.phones ?? createPhoneStore();
  const verifications = opts.verifications ?? createVerificationStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  const request = flow({
    name: "auth.requestPhoneOtp",
    unit: "auth",
    plane: "user",
    in: z.object({ phone: z.string().min(8) }),
    out: z.object({
      ok: z.literal(true),
      devOtp: z.string().optional(),
    }),
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const phone = input.phone.trim();
      if (!E164.test(phone)) return fail("AuthFailed", { reason: "invalid_phone" });
      const otp = generateOtp(6);
      const now = runtime.now();
      for (const row of verifications.rows.values()) {
        if (row.identifier === `phone-otp:${phone}` && row.consumedAt === null) {
          row.consumedAt = now;
        }
      }
      putVerification(verifications, {
        id: crypto.randomUUID(),
        identifier: `phone-otp:${phone}`,
        value: await hashChallenge(otp),
        expiresAt: now + ttlMs,
        createdAt: now,
        consumedAt: null,
        attempts: 0,
      });
      return {
        ok: true as const,
        ...(opts.exposeDevOtp ? { devOtp: otp } : {}),
      };
    },
  });

  const verify = flow({
    name: "auth.verifyPhoneOtp",
    unit: "auth",
    plane: "user",
    in: z.object({
      phone: z.string().min(8),
      otp: z.string().min(4).max(8),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const phone = input.phone.trim();
      if (!E164.test(phone)) return fail("AuthFailed", { reason: "invalid_phone" });
      const now = runtime.now();
      const row = findActiveVerification(verifications, `phone-otp:${phone}`, now);
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
      let userId = phones.byPhone.get(phone);
      if (!userId) {
        userId = crypto.randomUUID();
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

  return plugin("phoneNumber", { version: "0.0.1", config: { method: "phone-number" } })
    .needs("auth")
    .binding(bindPublicAuth("/phone/request", request, "otp"))
    .binding(bindPublicAuth("/phone/verify", verify, "otp"));
}
