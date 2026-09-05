/**
 * SSR / request cookie → access token helper for `createClient`.
 *
 * @module
 */

/** Cookie name options (defaults match Gate `oke.session_token`). */
export interface TokenFromCookiesOptions {
  /** Cookie name prefix (default `oke`). */
  readonly prefix?: string;
  /** Full access cookie name (overrides prefix). */
  readonly accessCookie?: string;
}

/** Acceptable cookie sources — no framework dependency. */
export type CookieSource =
  | string
  | Headers
  | Request
  | { readonly headers: { get(name: string): string | null } };

/**
 * Read the Gate access-token cookie from a Cookie header, Headers, or Request.
 *
 * @param source - Raw cookie header, Headers, Request, or `{ headers }`
 * @param opts - Cookie name overrides
 */
export function tokenFromRequestCookies(
  source: CookieSource,
  opts: TokenFromCookiesOptions = {},
): string | null {
  const header = cookieHeaderOf(source);
  if (!header) return null;
  const name = opts.accessCookie ?? `${opts.prefix ?? "oke"}.session_token`;
  const map = parseCookieHeader(header);
  return map.get(name) ?? null;
}

function cookieHeaderOf(source: CookieSource): string | null {
  if (typeof source === "string") return source;
  if (typeof Request !== "undefined" && source instanceof Request) {
    return source.headers.get("cookie");
  }
  if (typeof Headers !== "undefined" && source instanceof Headers) {
    return source.get("cookie");
  }
  if (
    source !== null &&
    typeof source === "object" &&
    "headers" in source &&
    source.headers &&
    typeof source.headers.get === "function"
  ) {
    return source.headers.get("cookie");
  }
  return null;
}

function parseCookieHeader(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out.set(k, decodeURIComponent(v));
    } catch {
      out.set(k, v);
    }
  }
  return out;
}
