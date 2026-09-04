/**
 * TOTP / email-OTP two-factor Gate auth method plugin.
 *
 * Login challenges are method-locked. Enrollment and method change are
 * privileged (step-up) and Forbidden while an unresolved login challenge exists.
 */

import { constantTimeEqual } from "../auth/constant-time.ts";
import { IdentityError, ensureUserExists, getUserById } from "../auth/identity.ts";
import {
  getActiveGateAuthContext,
  patchActiveGateAuthContext,
} from "../auth/method-context.ts";
import { sealOtp } from "../auth/otp-seal.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import {
  consumeChallenge,
  createPendingTwoFactorStore,
  createStepUpStore,
  getChallenge,
  grantStepUp,
  hasActiveChallenge,
  consumeStepUp,
  issueChallenge,
  twoFactorEmailOtpIdentifier,
  type PendingTwoFactorStore,
  type StepUpStore,
  type TwoFactorMethod,
  type TwoFactorRequiredOut,
} from "../auth/two-factor-challenge.ts";
import {
  consumeVerification,
  createVerificationStore,
  findActiveVerification,
  generateOtp,
  hashChallenge,
  invalidateVerifications,
  putVerification,
  type VerificationStore,
} from "../auth/verification.ts";
import { channel } from "../elements/channel.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  AuthFailed,
  AuthRateLimited,
  Forbidden,
  SessionTokensOut,
  bindPublicAuth,
  bindSessionAuth,
  createMethodRuntime,
  fail,
  flow,
  resolveMethodSecret,
  resolveSharedIdentities,
  z,
  type AuthMethodOptions,
} from "./auth/shared.ts";

/** Per-user TOTP / email-OTP + recovery state. */
export interface TwoFactorRow {
  userId: string;
  method: TwoFactorMethod;
  /** Base32 TOTP secret; empty when method is email_otp. */
  secret: string;
  enabled: boolean;
  /** SHA-256 hex of recovery codes (unused codes only). */
  recoveryHashes: Set<string>;
  createdAt: number;
  /** Override email for email_otp (else identity email). */
  email?: string;
  /** Pending method swap awaiting confirmation. */
  pending?: {
    method: TwoFactorMethod;
    secret: string;
    recoveryHashes: Set<string>;
  };
}

/** In-memory two-factor store. */
export interface TwoFactorStore {
  readonly byUserId: Map<string, TwoFactorRow>;
}

/**
 * Create an empty two-factor store.
 */
export function createTwoFactorStore(): TwoFactorStore {
  return { byUserId: new Map() };
}

/** Options for {@link twoFactor}. */
export interface TwoFactorOptions extends AuthMethodOptions {
  readonly factors?: TwoFactorStore;
  /** Issuer label for otpauth URLs (default `oke`). */
  readonly issuer?: string;
  /** Shared pending login challenges (defaults to active Gate auth store). */
  readonly pending?: PendingTwoFactorStore;
  /** Step-up grants for privileged ops. */
  readonly stepUp?: StepUpStore;
  /** Verification store for email OTP as second factor. */
  readonly verifications?: VerificationStore;
  /** Expose `devOtp` on login challenge / change-method when email_otp. */
  readonly exposeDevOtp?: boolean;
}

const EnableOut = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  recoveryCodes: z.array(z.string()),
  method: z.literal("totp"),
});

/**
 * Enable / verify / disable / change TOTP or email OTP two-factor (`oke_two_factor`).
 *
 * @param opts - Secret / session / factor store
 */
export function twoFactor(opts: TwoFactorOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = resolveSharedIdentities(opts);
  const factors = opts.factors ?? createTwoFactorStore();
  const issuer = opts.issuer ?? "oke";
  const secret = resolveMethodSecret(opts);
  const active = getActiveGateAuthContext();
  const pending =
    opts.pending ?? active?.pendingTwoFactor ?? createPendingTwoFactorStore();
  const stepUp = opts.stepUp ?? active?.stepUp ?? createStepUpStore();
  const verifications =
    opts.verifications ?? active?.twoFactorVerifications ?? createVerificationStore();
  const exposeDevOtp = opts.exposeDevOtp === true;

  const emailTmpl = channel.email({ from: "OKE <no-reply@oke.local>" }).template(
    "auth-2fa-email",
    {
      description: "Two-factor email OTP",
      schema: z.object({ email: z.string(), otp: z.string() }),
      locales: ["en", "ar"],
    },
  );

  async function provisionEmailOtp(userId: string, now: number): Promise<string | undefined> {
    const user = getUserById(identities, userId);
    const row = factors.byUserId.get(userId);
    const email = row?.email ?? (user?.email && user.email.includes("@") ? user.email : undefined);
    if (!email) return undefined;
    const otpCode = generateOtp(6);
    const identifier = twoFactorEmailOtpIdentifier(userId);
    invalidateVerifications(verifications, identifier, now);
    const sealed = await sealOtp(secret, otpCode);
    putVerification(verifications, {
      id: crypto.randomUUID(),
      identifier,
      value: await hashChallenge(otpCode),
      expiresAt: now + 10 * 60 * 1000,
      createdAt: now,
      consumedAt: null,
      attempts: 0,
      sealedOtp: sealed,
      lastDeliveredAt: now,
      lastChannel: "email",
      email,
      phone: null,
    });
    return otpCode;
  }

  async function beginLoginChallenge(userId: string): Promise<TwoFactorRequiredOut | null> {
    const row = factors.byUserId.get(userId);
    if (!row?.enabled) return null;
    const now = runtime.now();
    const challenge = issueChallenge(pending, {
      userId,
      method: row.method,
      now,
    });
    let devOtp: string | undefined;
    if (row.method === "email_otp") {
      const code = await provisionEmailOtp(userId, now);
      if (exposeDevOtp && code) devOtp = code;
    }
    return {
      twoFactorRequired: true as const,
      challengeId: challenge.id,
      method: row.method,
      userId,
      ...(devOtp ? { devOtp } : {}),
    };
  }

  patchActiveGateAuthContext({
    pendingTwoFactor: pending,
    stepUp,
    twoFactorVerifications: verifications,
    twoFactor: {
      isEnabled: (userId) => factors.byUserId.get(userId)?.enabled === true,
      beginLoginChallenge,
    },
  });

  async function verifyCurrentFactor(
    userId: string,
    code: string,
    now: number,
  ): Promise<boolean> {
    const row = factors.byUserId.get(userId);
    if (!row?.enabled) return false;
    const trimmed = code.trim().replace(/\s+/g, "");
    if (row.method === "totp") {
      if (await verifyTotp(row.secret, trimmed)) return true;
      const hash = await sha256Hex(trimmed);
      if (row.recoveryHashes.has(hash)) {
        row.recoveryHashes.delete(hash);
        return true;
      }
      return false;
    }
    // email_otp
    const vRow = findActiveVerification(verifications, twoFactorEmailOtpIdentifier(userId), now);
    if (!vRow) return false;
    if (vRow.attempts >= 5) {
      consumeVerification(vRow, now);
      return false;
    }
    const hash = await hashChallenge(trimmed);
    if (!constantTimeEqual(hash, vRow.value)) {
      vRow.attempts += 1;
      if (vRow.attempts >= 5) consumeVerification(vRow, now);
      return false;
    }
    consumeVerification(vRow, now);
    return true;
  }

  const enable = flow("auth.twoFactorEnable", {
    plane: "user",
    out: EnableOut,
    errors: { AuthFailed, Forbidden },
    do: async (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const now = runtime.now();
      if (hasActiveChallenge(pending, userId, now)) {
        return fail("Forbidden", { reason: "active_2fa_challenge" });
      }
      try {
        await ensureUserExists(identities, userId, now);
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "unauthenticated" });
        }
        throw err;
      }
      const existing = factors.byUserId.get(userId);
      if (existing?.enabled) {
        if (!consumeStepUp(stepUp, userId, ["enroll", "change"], now)) {
          return fail("Forbidden", { reason: "step_up_required" });
        }
      }
      const totpSecret = generateBase32Secret(20);
      const recoveryCodes = Array.from({ length: 8 }, () => randomRecoveryCode());
      const recoveryHashes = new Set<string>();
      for (const code of recoveryCodes) {
        recoveryHashes.add(await sha256Hex(code));
      }
      factors.byUserId.set(userId, {
        userId,
        method: "totp",
        secret: totpSecret,
        enabled: true,
        recoveryHashes,
        createdAt: now,
      });
      const label = encodeURIComponent(userId);
      const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${label}?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      return { secret: totpSecret, otpauthUrl, recoveryCodes, method: "totp" as const };
    },
  });

  const verify = flow("auth.twoFactorVerify", {
    plane: "user",
    in: z.object({
      challengeId: z.string().min(1),
      code: z.string().min(4).max(16),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const now = runtime.now();
      const challenge = getChallenge(pending, input.challengeId, now);
      if (!challenge) return fail("AuthFailed", { reason: "invalid_credentials" });
      const row = factors.byUserId.get(challenge.userId);
      if (!row?.enabled) return fail("AuthFailed", { reason: "invalid_credentials" });
      if (row.method !== challenge.method) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const ok = await verifyCurrentFactor(challenge.userId, input.code, now);
      if (!ok) return fail("AuthFailed", { reason: "invalid_credentials" });
      consumeChallenge(pending, challenge, now);
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: challenge.userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: challenge.userId,
      };
    },
  });

  const stepUpFlow = flow("auth.twoFactorStepUp", {
    plane: "user",
    in: z.object({
      code: z.string().min(4).max(16),
      purpose: z.enum(["enroll", "change", "disable"]).default("enroll"),
    }),
    out: z.object({ ok: z.literal(true), purpose: z.enum(["enroll", "change", "disable"]) }),
    errors: { AuthFailed, Forbidden },
    effects: { sends: ["auth-2fa-email"] },
    do: async (input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const now = runtime.now();
      if (hasActiveChallenge(pending, userId, now)) {
        return fail("Forbidden", { reason: "active_2fa_challenge" });
      }
      const row = factors.byUserId.get(userId);
      if (!row?.enabled) return fail("AuthFailed", { reason: "invalid_credentials" });
      // Ensure email OTP is provisioned if caller needs a fresh code for step-up.
      if (row.method === "email_otp") {
        const activeOtp = findActiveVerification(
          verifications,
          twoFactorEmailOtpIdentifier(userId),
          now,
        );
        if (!activeOtp) await provisionEmailOtp(userId, now);
      }
      const ok = await verifyCurrentFactor(userId, input.code, now);
      if (!ok) return fail("AuthFailed", { reason: "invalid_credentials" });
      const purpose = input.purpose;
      grantStepUp(stepUp, userId, purpose, now);
      return { ok: true as const, purpose };
    },
  });

  const changeMethod = flow("auth.twoFactorChangeMethod", {
    plane: "user",
    in: z.object({
      method: z.enum(["totp", "email_otp"]),
      /** Required when switching to email_otp if the identity has no email. */
      email: z.string().min(3).optional(),
    }),
    out: z.union([
      EnableOut,
      z.object({
        ok: z.literal(true),
        method: z.literal("email_otp"),
        pending: z.literal(true),
        devOtp: z.string().optional(),
      }),
    ]),
    errors: { AuthFailed, Forbidden },
    effects: { sends: ["auth-2fa-email"] },
    do: async (input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const now = runtime.now();
      if (hasActiveChallenge(pending, userId, now)) {
        return fail("Forbidden", { reason: "active_2fa_challenge" });
      }
      if (!consumeStepUp(stepUp, userId, ["change", "enroll"], now)) {
        return fail("Forbidden", { reason: "step_up_required" });
      }
      const current = factors.byUserId.get(userId);
      if (!current?.enabled) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      if (input.method === "totp") {
        const totpSecret = generateBase32Secret(20);
        const recoveryCodes = Array.from({ length: 8 }, () => randomRecoveryCode());
        const recoveryHashes = new Set<string>();
        for (const code of recoveryCodes) {
          recoveryHashes.add(await sha256Hex(code));
        }
        current.pending = {
          method: "totp",
          secret: totpSecret,
          recoveryHashes,
        };
        // Re-grant so confirm can proceed in the same privileged window.
        grantStepUp(stepUp, userId, "change", now);
        const label = encodeURIComponent(userId);
        const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${label}?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
        return {
          secret: totpSecret,
          otpauthUrl,
          recoveryCodes,
          method: "totp" as const,
        };
      }
      // email_otp pending — confirm with emailed code
      const user = getUserById(identities, userId);
      const email =
        input.email ??
        current.email ??
        (user?.email && user.email.includes("@") ? user.email : undefined);
      if (!email || !email.includes("@")) {
        return fail("AuthFailed", { reason: "invalid_email" });
      }
      current.email = email;
      current.pending = {
        method: "email_otp",
        secret: "",
        recoveryHashes: new Set(),
      };
      const code = await provisionEmailOtp(userId, now);
      grantStepUp(stepUp, userId, "change", now);
      return {
        ok: true as const,
        method: "email_otp" as const,
        pending: true as const,
        ...(exposeDevOtp && code ? { devOtp: code } : {}),
      };
    },
  });

  const confirmChange = flow("auth.twoFactorConfirmChange", {
    plane: "user",
    in: z.object({
      code: z.string().min(4).max(16),
    }),
    out: z.object({
      ok: z.literal(true),
      method: z.enum(["totp", "email_otp"]),
    }),
    errors: { AuthFailed, Forbidden },
    do: async (input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const now = runtime.now();
      if (hasActiveChallenge(pending, userId, now)) {
        return fail("Forbidden", { reason: "active_2fa_challenge" });
      }
      if (!consumeStepUp(stepUp, userId, ["change", "enroll"], now)) {
        return fail("Forbidden", { reason: "step_up_required" });
      }
      const current = factors.byUserId.get(userId);
      const pendingEnroll = current?.pending;
      if (!current?.enabled || !pendingEnroll) {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      if (pendingEnroll.method === "totp") {
        if (!(await verifyTotp(pendingEnroll.secret, input.code.trim().replace(/\s+/g, "")))) {
          // Restore step-up so the user can retry confirm.
          grantStepUp(stepUp, userId, "change", now);
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        // Invalidate old method immediately — replace with pending TOTP.
        current.method = "totp";
        current.secret = pendingEnroll.secret;
        current.recoveryHashes = pendingEnroll.recoveryHashes;
        current.pending = undefined;
        current.email = undefined;
        return { ok: true as const, method: "totp" as const };
      }
      // Confirm email_otp by consuming the sealed OTP for this user.
      const vRow = findActiveVerification(
        verifications,
        twoFactorEmailOtpIdentifier(userId),
        now,
      );
      if (!vRow) return fail("AuthFailed", { reason: "invalid_credentials" });
      const trimmed = input.code.trim().replace(/\s+/g, "");
      const hash = await hashChallenge(trimmed);
      if (!constantTimeEqual(hash, vRow.value)) {
        vRow.attempts += 1;
        grantStepUp(stepUp, userId, "change", now);
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      consumeVerification(vRow, now);
      // Invalidate old TOTP secret / recovery immediately.
      current.method = "email_otp";
      current.secret = "";
      current.recoveryHashes = new Set();
      current.pending = undefined;
      return { ok: true as const, method: "email_otp" as const };
    },
  });

  const requestEmailOtp = flow("auth.twoFactorRequestEmailOtp", {
    plane: "user",
    in: z.object({
      challengeId: z.string().min(1).optional(),
    }),
    out: z.object({
      ok: z.literal(true),
      devOtp: z.string().optional(),
    }),
    errors: { AuthFailed, AuthRateLimited, Forbidden },
    effects: { sends: [emailTmpl.name] },
    do: async (input, fx) => {
      const now = runtime.now();
      let userId = fx.auth.userId;
      if (input.challengeId) {
        const challenge = getChallenge(pending, input.challengeId, now);
        if (!challenge) return fail("AuthFailed", { reason: "invalid_credentials" });
        if (challenge.method !== "email_otp") {
          return fail("Forbidden", { reason: "method_locked" });
        }
        userId = challenge.userId;
      }
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const row = factors.byUserId.get(userId);
      if (!row?.enabled || row.method !== "email_otp") {
        return fail("AuthFailed", { reason: "invalid_credentials" });
      }
      const code = await provisionEmailOtp(userId, now);
      if (!code) return fail("AuthFailed", { reason: "invalid_credentials" });
      const user = getUserById(identities, userId);
      const email = row.email ?? user?.email;
      if (email) {
        await fx.deliverOtp({
          channels: ["email"],
          templates: { email: emailTmpl.name, sms: emailTmpl.name, whatsapp: emailTmpl.name },
          email,
          data: { otp: code, email },
        });
      }
      return {
        ok: true as const,
        ...(exposeDevOtp ? { devOtp: code } : {}),
      };
    },
  });

  const disable = flow("auth.twoFactorDisable", {
    plane: "user",
    out: z.object({ ok: z.literal(true) }),
    errors: { AuthFailed, Forbidden },
    do: (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const now = runtime.now();
      if (hasActiveChallenge(pending, userId, now)) {
        return fail("Forbidden", { reason: "active_2fa_challenge" });
      }
      const existing = factors.byUserId.get(userId);
      if (existing?.enabled) {
        if (!consumeStepUp(stepUp, userId, ["disable", "change"], now)) {
          return fail("Forbidden", { reason: "step_up_required" });
        }
      }
      factors.byUserId.delete(userId);
      return { ok: true as const };
    },
  });

  return plugin("twoFactor", { version: "0.0.1", config: { method: "two-factor" } })
    .needs("auth")
    .table("oke_two_factor", undefined, { plane: "user", description: "TOTP secrets + recovery" })
    .binding(bindSessionAuth("/two-factor/enable", enable))
    .binding(bindPublicAuth("/two-factor/verify", verify, "otp"))
    .binding(bindSessionAuth("/two-factor/step-up", stepUpFlow))
    .binding(bindSessionAuth("/two-factor/change-method", changeMethod))
    .binding(bindSessionAuth("/two-factor/confirm-change", confirmChange))
    .binding(bindPublicAuth("/two-factor/request-email-otp", requestEmailOtp, "otp"))
    .binding(bindSessionAuth("/two-factor/disable", disable));
}

/**
 * Verify a 6-digit TOTP against a base32 secret (RFC 6238, 30s step, ±1 window).
 *
 * @param secretBase32 - Shared secret
 * @param code - Submitted code
 * @param nowSec - Epoch seconds (test injection)
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(nowSec / 30);
  // Compare every window with constant-time equality — never short-circuit on
  // the first match (avoids leaking which step matched via `===` timing).
  let ok = 0;
  for (let w = -1; w <= 1; w++) {
    const otp = await hotp(key, counter + w);
    ok |= constantTimeEqual(otp, code) ? 1 : 0;
  }
  return ok === 1;
}

async function hotp(key: Uint8Array, counter: number): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = sig[sig.length - 1]! & 0x0f;
  const bin =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

function generateBase32Secret(byteLen: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return base32Encode(bytes);
}

function randomRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Uint8Array {
  const cleaned = input
    .replace(/=+$/, "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
