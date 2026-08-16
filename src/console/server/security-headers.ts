/**
 * Console security headers — CSP, framing, cookies (console §10).
 */

/** Strict Content-Security-Policy for the Console document. */
export const CONSOLE_CSP: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self'",
].join("; ");

/**
 * CSP for Vite-proxied Console UI during `oke dev`.
 * The React refresh preamble is an inline module script — production
 * `script-src 'self'` blocks it and the SPA never mounts.
 */
export const CONSOLE_VITE_DEV_CSP: string = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss: http://127.0.0.1:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self'",
].join("; ");

/** CSP for sandboxed plugin panel iframes (no operator session reach). */
export const PLUGIN_FRAME_CSP: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** Sandbox attribute for plugin panels — no `allow-same-origin`. */
export const PLUGIN_IFRAME_SANDBOX: string = "allow-scripts allow-forms";

/**
 * Apply Console security headers to a response.
 *
 * @param response - Downstream response
 * @param opts - Extra header overrides
 */
export function withConsoleSecurityHeaders(
  response: Response,
  opts?: { readonly contentType?: string; readonly csp?: string },
): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", opts?.csp ?? CONSOLE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "interest-cohort=()");
  if (opts?.contentType) {
    headers.set("Content-Type", opts.contentType);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Build a `Set-Cookie` value with `SameSite=Strict`.
 *
 * @param name - Cookie name
 * @param value - Cookie value
 * @param opts - Max-age / path / clear
 */
export function consoleSessionCookie(
  name: string,
  value: string,
  opts?: {
    readonly maxAgeSec?: number;
    readonly clear?: boolean;
  },
): string {
  const parts = [
    `${name}=${opts?.clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    // Secure when not on plain localhost loopback in production — callers
    // may append; we always set SameSite=Strict from the first commit.
  ];
  if (opts?.clear) {
    parts.push("Max-Age=0");
  } else if (opts?.maxAgeSec !== undefined) {
    parts.push(`Max-Age=${opts.maxAgeSec}`);
  }
  return parts.join("; ");
}

/** Cookie names used by the Console. */
export const CONSOLE_COOKIES = {
  access: "oke_console_at",
  refresh: "oke_console_rt",
} as const;
