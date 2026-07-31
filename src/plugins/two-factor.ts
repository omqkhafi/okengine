/**
 * TOTP two-factor Gate auth method plugin (RFC 6238, HMAC-SHA1).
 *
 * v1 verify accepts `{ userId, code }` after password sign-in when 2FA is enabled.
 */

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

/** Per-user TOTP + recovery state. */
export interface TwoFactorRow {
  userId: string;
  secret: string;
  enabled: boolean;
  /** SHA-256 hex of recovery codes (unused codes only). */
  recoveryHashes: Set<string>;
  createdAt: number;
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
}

/**
 * Enable / verify / disable TOTP two-factor (`oke_two_factor`).
 *
 * @param opts - Secret / session / factor store
 */
export function twoFactor(opts: TwoFactorOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const factors = opts.factors ?? createTwoFactorStore();
  const issuer = opts.issuer ?? "oke";

  const enable = flow({
    name: "auth.twoFactorEnable",
    unit: "auth",
    plane: "user",
    out: z.object({
      secret: z.string(),
      otpauthUrl: z.string(),
      recoveryCodes: z.array(z.string()),
    }),
    errors: { AuthFailed },
    do: async (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const secret = generateBase32Secret(20);
      const recoveryCodes = Array.from({ length: 8 }, () => randomRecoveryCode());
      const recoveryHashes = new Set<string>();
      for (const code of recoveryCodes) {
        recoveryHashes.add(await sha256Hex(code));
      }
      factors.byUserId.set(userId, {
        userId,
        secret,
        enabled: true,
        recoveryHashes,
        createdAt: runtime.now(),
      });
      const label = encodeURIComponent(userId);
      const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      return { secret, otpauthUrl, recoveryCodes };
    },
  });

  const verify = flow({
    name: "auth.twoFactorVerify",
    unit: "auth",
    plane: "user",
    in: z.object({
      userId: z.string().min(1),
      code: z.string().min(6).max(16),
    }),
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const row = factors.byUserId.get(input.userId);
      if (!row?.enabled) return fail("AuthFailed", { reason: "invalid_credentials" });
      const code = input.code.trim().replace(/\s+/g, "");
      const totpOk = await verifyTotp(row.secret, code);
      if (!totpOk) {
        const hash = await sha256Hex(code);
        if (!row.recoveryHashes.has(hash)) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        row.recoveryHashes.delete(hash);
      }
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: input.userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: input.userId,
      };
    },
  });

  const disable = flow({
    name: "auth.twoFactorDisable",
    unit: "auth",
    plane: "user",
    out: z.object({ ok: z.literal(true) }),
    errors: { AuthFailed },
    do: (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      factors.byUserId.delete(userId);
      return { ok: true as const };
    },
  });

  return plugin("twoFactor", { version: "0.0.1", config: { method: "two-factor" } })
    .needs("auth")
    .table("oke_two_factor", undefined, { plane: "user", description: "TOTP secrets + recovery" })
    .binding(bindSessionAuth("/two-factor/enable", enable))
    .binding(bindPublicAuth("/two-factor/verify", verify, "otp"))
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
  for (let w = -1; w <= 1; w++) {
    const otp = await hotp(key, counter + w);
    if (otp === code) return true;
  }
  return false;
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
