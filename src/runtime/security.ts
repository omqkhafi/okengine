/**
 * DNS-rebinding defence — Host and Origin validation (console §10.1).
 *
 * Mandatory and on by default for every served request on 6530 / 6533 / 6535.
 * CVE-2025-66414 and the Vite Host-header flaw are the same class: without
 * this check, a malicious site can reach a localhost server past the
 * browser's same-origin policy.
 */

import type { ServeOptions } from "./types.ts";

/** Loopback names always accepted alongside the listen hostname. */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]"];

/**
 * Build the effective allow-list: loopback + listen hostname + user extras.
 *
 * @param hostname - Listen hostname from {@link ServeOptions}
 * @param extra - User-supplied `allowedHosts`
 */
export function resolveAllowedHosts(
  hostname: string,
  extra?: readonly string[],
): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const h of LOOPBACK_HOSTS) hosts.add(h);
  const listen = normalizeHost(hostname);
  if (listen && listen !== "0.0.0.0" && listen !== "::" && listen !== "[::]") {
    hosts.add(listen);
  }
  if (extra) {
    for (const h of extra) {
      const n = normalizeHost(h);
      if (n) hosts.add(n);
    }
  }
  return hosts;
}

/**
 * Normalize a Host header value or hostname for comparison.
 * Strips port, lowercases, keeps IPv6 bracket form as a sibling key.
 *
 * @param raw - Raw host or `host:port`
 */
export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.length === 0) return "";

  // IPv6 with port: "[::1]:6530"
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) {
      const bare = host.slice(1, end);
      return bare;
    }
  }

  // Strip :port for host:port (not IPv6)
  const colon = host.lastIndexOf(":");
  if (colon !== -1 && host.indexOf(":") === colon) {
    host = host.slice(0, colon);
  }
  return host;
}

/**
 * True when `host` is listed or matches a leading-dot suffix entry
 * (Vite-style `allowedHosts`: `.example.com` allows `a.example.com`).
 *
 * @param host - Normalized host
 * @param allowed - Allow-list
 */
export function isHostAllowed(host: string, allowed: ReadonlySet<string>): boolean {
  if (host.length === 0) return false;
  if (allowed.has(host)) return true;
  // Bracketed IPv6 sibling
  if (allowed.has(`[${host}]`)) return true;
  for (const entry of allowed) {
    if (entry.startsWith(".") && (host === entry.slice(1) || host.endsWith(entry))) {
      return true;
    }
  }
  return false;
}

/** Result of {@link checkRequestSecurity}. */
export type SecurityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "host" | "origin" };

/**
 * Validate Host (required) and Origin (when present) against `allowedHosts`.
 *
 * @param request - Incoming request
 * @param allowedHosts - Effective allow-list
 */
export function checkRequestSecurity(
  request: Request,
  allowedHosts: ReadonlySet<string>,
): SecurityCheck {
  const hostHeader = request.headers.get("host");
  if (hostHeader === null || hostHeader.trim().length === 0) {
    return { ok: false, reason: "host" };
  }
  const host = normalizeHost(hostHeader);
  if (!isHostAllowed(host, allowedHosts)) {
    return { ok: false, reason: "host" };
  }

  const origin = request.headers.get("origin");
  if (origin !== null && origin.length > 0) {
    if (origin === "null") {
      return { ok: false, reason: "origin" };
    }
    let originHost: string;
    try {
      originHost = normalizeHost(new URL(origin).host);
    } catch {
      return { ok: false, reason: "origin" };
    }
    if (!isHostAllowed(originHost, allowedHosts)) {
      return { ok: false, reason: "origin" };
    }
  }

  return { ok: true };
}

/** 403 body for a failed Host / Origin check. */
export function forbiddenResponse(reason: "host" | "origin"): Response {
  const message =
    reason === "host" ? "Forbidden: unexpected Host header" : "Forbidden: unexpected Origin header";
  return new Response(message, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Wrap a fetch handler with mandatory Host / Origin validation.
 *
 * @param inner - Downstream handler (usually `app.fetch`)
 * @param options - Serve options (for `allowedHosts` + hostname)
 * @param hostname - Resolved listen hostname
 */
export function secureFetch(
  inner: (request: Request) => Response | Promise<Response>,
  options: ServeOptions | undefined,
  hostname: string,
): (request: Request) => Promise<Response> {
  const allowed = resolveAllowedHosts(hostname, options?.allowedHosts);
  return async (request) => {
    const check = checkRequestSecurity(request, allowed);
    if (!check.ok) return forbiddenResponse(check.reason);
    return inner(request);
  };
}
