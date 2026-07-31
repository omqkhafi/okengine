/**
 * Official `headers` plugin — the complete secure-headers set on every HTTP
 * response (helmet parity, API-first defaults). Uses only the public plugin
 * API (unified-theory §14).
 */

import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  isConfigSource,
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  type ConfigSource,
} from "./config-source.ts";
import { setUnlessPresent, withHeaders } from "./response-headers.ts";

/** HSTS value options (see {@link HeadersOptions.hsts}). */
export interface HstsOptions {
  /** `max-age` in seconds. Default `31536000` (one year). */
  readonly maxAge?: number;
  /** Append `includeSubDomains`. Default `false`. */
  readonly includeSubDomains?: boolean;
  /** Append `preload`. Only meaningful with subdomains + a ≥1-year max-age. */
  readonly preload?: boolean;
}

/** Structured CSP (see {@link HeadersOptions.contentSecurityPolicy}). */
export interface CspOptions {
  /**
   * Directive map — kebab-case (`script-src`) or camelCase (`scriptSrc`)
   * keys, values as string arrays. An empty array emits a bare directive
   * (e.g. `upgrade-insecure-requests`).
   */
  readonly directives: Readonly<Record<string, readonly string[]>>;
  /** Merge over {@link defaultCspDirectives}. Default `true`. */
  readonly useDefaults?: boolean;
  /** Emit as `Content-Security-Policy-Report-Only`. Default `false`. */
  readonly reportOnly?: boolean;
}

/**
 * Helmet's default CSP — the baseline `directives` merge over unless
 * `useDefaults: false`.
 */
export const defaultCspDirectives: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "font-src": ["'self'", "https:", "data:"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "script-src": ["'self'"],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "https:", "'unsafe-inline'"],
  "upgrade-insecure-requests": [],
};

/** Options for {@link headers}. */
export interface HeadersOptions {
  /**
   * Content-Security-Policy — a raw header string, or a structured
   * {@link CspOptions} (directive builder over helmet's defaults, optional
   * report-only mode). Omitted unless provided.
   */
  readonly contentSecurityPolicy?: string | CspOptions;
  /** X-Frame-Options value. Default `"DENY"`. */
  readonly frameOptions?: "DENY" | "SAMEORIGIN";
  /** Referrer-Policy value. Default `"no-referrer"`. */
  readonly referrerPolicy?: string;
  /**
   * Strict-Transport-Security. `true` → one-year `max-age`; pass an object
   * to tune. Default off — HSTS is sticky, and local dev is plain HTTP, so
   * enable it deliberately for HTTPS deployments.
   */
  readonly hsts?: boolean | HstsOptions;
  /** Permissions-Policy value (e.g. `"camera=(), microphone=()"`). Omitted unless provided. */
  readonly permissionsPolicy?: string;
  /**
   * Cross-Origin-Opener-Policy value. Omitted unless provided — opt-in
   * because OKE serves APIs, where cross-origin clients are legitimate
   * (helmet targets web pages and defaults it on).
   */
  readonly crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  /** Cross-Origin-Resource-Policy value. Omitted unless provided (same API rationale). */
  readonly crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin";
  /** Cross-Origin-Embedder-Policy value. Omitted unless provided (helmet also defaults it off). */
  readonly crossOriginEmbedderPolicy?: "require-corp" | "credentialless";
  /** Origin-Agent-Cluster header. Default `true` → `?1`. */
  readonly originAgentCluster?: boolean;
  /**
   * X-DNS-Prefetch-Control. Default `true` → `off` (privacy-preserving);
   * `{ allow: true }` → `on`; `false` omits the header.
   */
  readonly dnsPrefetchControl?: boolean | { readonly allow: boolean };
  /** X-Download-Options: noopen (legacy IE8 mitigation, helmet parity). Default `true`. */
  readonly downloadOptions?: boolean;
  /** X-Permitted-Cross-Domain-Policies value. Default `"none"`. */
  readonly permittedCrossDomainPolicies?: "none" | "master-only" | "by-content-type" | "all";
  /**
   * X-Powered-By handling. Default `true` → remove the header (it leaks
   * framework fingerprints). A string sets a custom value; `false` keeps it.
   */
  readonly poweredBy?: boolean | string;
  /**
   * X-XSS-Protection: 0 — disables the legacy, buggy browser XSS auditor
   * (helmet parity; modern defense is CSP). Default `true`.
   */
  readonly xssProtection?: boolean;
  /**
   * Replace headers the app already set. Default `false` — an explicit
   * app-level value always wins.
   */
  readonly override?: boolean;
}

/** Render the Strict-Transport-Security header value. */
function hstsValue(hsts: boolean | HstsOptions): string {
  const opts: HstsOptions = typeof hsts === "object" ? hsts : {};
  let value = `max-age=${opts.maxAge ?? 31536000}`;
  if (opts.includeSubDomains) value += "; includeSubDomains";
  if (opts.preload) value += "; preload";
  return value;
}

/** camelCase directive keys → kebab-case (`scriptSrc` → `script-src`). */
function directiveName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Build a CSP header value from a directive map. */
function buildCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, values]) => {
      const kebab = directiveName(name);
      return values.length === 0 ? kebab : `${kebab} ${values.join(" ")}`;
    })
    .join("; ");
}

/** Resolve the CSP option into header name + value. */
function cspEntry(option: string | CspOptions): { readonly name: string; readonly value: string } {
  if (typeof option === "string") return { name: "content-security-policy", value: option };
  const useDefaults = option.useDefaults ?? true;
  const merged: Record<string, readonly string[]> = useDefaults
    ? { ...defaultCspDirectives, ...option.directives }
    : { ...option.directives };
  return {
    name:
      (option.reportOnly ?? false)
        ? "content-security-policy-report-only"
        : "content-security-policy",
    value: buildCsp(merged),
  };
}

/**
 * Apply the complete secure-headers set to every HTTP response, including
 * failures (runs at `onResponse`, which fires after `onError` too). Covers
 * every helmet.js middleware; API-first deviations (opt-in HSTS, COOP,
 * CORP) are documented per option.
 *
 * Accepts static options or a {@link ConfigSource} for DB-driven config
 * (e.g. flip `hsts` from the database without a redeploy).
 *
 * @param options - Header values, or a config source
 */
export function headers(options: HeadersOptions | ConfigSource<HeadersOptions> = {}): PluginDef {
  const def = plugin("headers", {
    version: "0.1.0",
    config: pluginConfigSnapshot(options),
  }).hook("onResponse", (ctx) => {
    if (!ctx.response) return;
    const resolved = resolvePluginOptions(options);
    const override = resolved.override ?? false;

    ctx.response = withHeaders(ctx.response, (headers) => {
      setUnlessPresent(headers, "x-content-type-options", "nosniff", override);
      setUnlessPresent(headers, "x-frame-options", resolved.frameOptions ?? "DENY", override);
      setUnlessPresent(
        headers,
        "referrer-policy",
        resolved.referrerPolicy ?? "no-referrer",
        override,
      );

      if (resolved.originAgentCluster ?? true) {
        setUnlessPresent(headers, "origin-agent-cluster", "?1", override);
      }
      const dns = resolved.dnsPrefetchControl ?? true;
      if (dns !== false) {
        const allow = typeof dns === "object" ? dns.allow : false;
        setUnlessPresent(headers, "x-dns-prefetch-control", allow ? "on" : "off", override);
      }
      if (resolved.downloadOptions ?? true) {
        setUnlessPresent(headers, "x-download-options", "noopen", override);
      }
      setUnlessPresent(
        headers,
        "x-permitted-cross-domain-policies",
        resolved.permittedCrossDomainPolicies ?? "none",
        override,
      );
      if (resolved.xssProtection ?? true) {
        setUnlessPresent(headers, "x-xss-protection", "0", override);
      }

      const poweredBy = resolved.poweredBy ?? true;
      if (poweredBy === true) {
        headers.delete("x-powered-by");
      } else if (typeof poweredBy === "string") {
        setUnlessPresent(headers, "x-powered-by", poweredBy, override);
      }

      if (resolved.contentSecurityPolicy !== undefined) {
        const csp = cspEntry(resolved.contentSecurityPolicy);
        setUnlessPresent(headers, csp.name, csp.value, override);
      }
      if (resolved.hsts !== undefined && resolved.hsts !== false) {
        setUnlessPresent(headers, "strict-transport-security", hstsValue(resolved.hsts), override);
      }
      if (resolved.permissionsPolicy !== undefined) {
        setUnlessPresent(headers, "permissions-policy", resolved.permissionsPolicy, override);
      }
      if (resolved.crossOriginOpenerPolicy !== undefined) {
        setUnlessPresent(
          headers,
          "cross-origin-opener-policy",
          resolved.crossOriginOpenerPolicy,
          override,
        );
      }
      if (resolved.crossOriginResourcePolicy !== undefined) {
        setUnlessPresent(
          headers,
          "cross-origin-resource-policy",
          resolved.crossOriginResourcePolicy,
          override,
        );
      }
      if (resolved.crossOriginEmbedderPolicy !== undefined) {
        setUnlessPresent(
          headers,
          "cross-origin-embedder-policy",
          resolved.crossOriginEmbedderPolicy,
          override,
        );
      }
    });
  });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
