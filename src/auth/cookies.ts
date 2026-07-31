/**
 * Opt-in auth cookie helpers (Phase 1a) — Bearer remains the default transport.
 *
 * Mirrors Console's cookie→Bearer pattern for app Gate auth when enabled.
 */

import type { ResolvedAuthCookies } from "./config.ts";

/** Cookie names derived from prefix. */
export interface AuthCookieNames {
  readonly access: string;
  readonly refresh: string;
}

/**
 * Cookie names for a resolved cookie config.
 *
 * @param cookies - Resolved cookie options
 */
export function authCookieNames(cookies: ResolvedAuthCookies): AuthCookieNames {
  const p = cookies.prefix;
  return {
    access: `${p}.session_token`,
    refresh: `${p}.refresh_token`,
  };
}

/**
 * Build `Set-Cookie` header values for access + refresh tokens.
 *
 * @param cookies - Resolved cookie options
 * @param tokens - Issued tokens
 * @param maxAgeSec - Max-Age for refresh (access uses shorter when provided)
 */
export function buildAuthSetCookies(
  cookies: ResolvedAuthCookies,
  tokens: { readonly accessToken: string; readonly refreshToken: string },
  maxAgeSec: { readonly access: number; readonly refresh: number },
): string[] {
  if (!cookies.enabled) return [];
  const names = authCookieNames(cookies);
  return [
    serializeCookie(names.access, tokens.accessToken, cookies, maxAgeSec.access),
    serializeCookie(names.refresh, tokens.refreshToken, cookies, maxAgeSec.refresh),
  ];
}

/**
 * Build clearing `Set-Cookie` headers (logout).
 *
 * @param cookies - Resolved cookie options
 */
export function clearAuthSetCookies(cookies: ResolvedAuthCookies): string[] {
  if (!cookies.enabled) return [];
  const names = authCookieNames(cookies);
  return [
    serializeCookie(names.access, "", cookies, 0),
    serializeCookie(names.refresh, "", cookies, 0),
  ];
}

/**
 * Extract Bearer-equivalent token from Cookie header when cookies enabled.
 * Prefers access cookie; falls back to refresh only when caller asks.
 *
 * @param cookieHeader - Raw `Cookie` header
 * @param cookies - Resolved cookie options
 */
export function tokenFromCookieHeader(
  cookieHeader: string | null | undefined,
  cookies: ResolvedAuthCookies,
): string | undefined {
  if (!cookies.enabled || !cookieHeader) return undefined;
  const names = authCookieNames(cookies);
  const map = parseCookieHeader(cookieHeader);
  return map.get(names.access) || undefined;
}

function serializeCookie(
  name: string,
  value: string,
  cookies: ResolvedAuthCookies,
  maxAge: number,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${cookies.path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    `SameSite=${capitalizeSameSite(cookies.sameSite)}`,
  ];
  if (cookies.secure) parts.push("Secure");
  const domain = cookies.domain ?? (cookies.crossSubdomain ? undefined : undefined);
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function capitalizeSameSite(v: "strict" | "lax" | "none"): string {
  if (v === "none") return "None";
  if (v === "lax") return "Lax";
  return "Strict";
}

/**
 * Parse a Cookie header into a map.
 *
 * @param header - Raw Cookie header
 */
export function parseCookieHeader(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out.set(k, decodeURIComponent(v));
    } catch {
      out.set(k, v);
    }
  }
  return out;
}
