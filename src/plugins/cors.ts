/**
 * Official `cors` plugin — cross-origin rules at the edge: preflight
 * `OPTIONS` answered even for paths bound to other methods, plus CORS
 * headers on matched responses. Uses the public plugin API (§14) —
 * including the edge contribution for requests that match no flow.
 */

import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  isConfigSource,
  type ConfigSource,
} from "./config-source.ts";
import { appendVary, withHeaders } from "./headers.ts";

/** Options for {@link cors}. */
export interface CorsOptions {
  /**
   * Origins allowed cross-origin: `"*"` for any, one origin string, or an
   * exact-match list (`"https://app.example.com"`). Default **none** —
   * cross-origin is closed until you open it. Same-origin traffic needs
   * no CORS headers at all.
   */
  readonly origin?: "*" | string | readonly string[];
  /**
   * Methods answered on preflight. Default covers the verbs `http.*`
   * triggers bind: GET · HEAD · POST · PUT · PATCH · DELETE · OPTIONS.
   */
  readonly methods?: readonly string[];
  /**
   * `Access-Control-Allow-Headers` on preflight. Default reflects the
   * request's `Access-Control-Request-Headers` back to it.
   */
  readonly allowedHeaders?: readonly string[];
  /** `Access-Control-Expose-Headers` on actual responses. Omitted unless provided. */
  readonly exposedHeaders?: readonly string[];
  /**
   * Send `Access-Control-Allow-Credentials: true`. When set, an `origin`
   * of `"*"` is answered by reflecting the request origin — browsers
   * reject `"*"` together with credentials.
   */
  readonly credentials?: boolean;
  /** `Access-Control-Max-Age` seconds on preflight. Omitted unless provided. */
  readonly maxAge?: number;
}

const DEFAULT_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** True when `origin` is permitted by the configured origin rule. */
export function originAllowed(origin: string, rule: CorsOptions["origin"]): boolean {
  if (rule === undefined) return false;
  if (rule === "*") return true;
  if (typeof rule === "string") return origin === rule;
  return rule.includes(origin);
}

/** The `Access-Control-Allow-Origin` value for a permitted origin. */
function allowOriginValue(origin: string, options: CorsOptions): string {
  return options.origin === "*" && options.credentials !== true ? "*" : origin;
}

/** Is this request a CORS preflight? */
function isPreflight(request: Request, method: string): boolean {
  return (
    method === "OPTIONS" &&
    request.headers.get("origin") !== null &&
    request.headers.get("access-control-request-method") !== null
  );
}

/**
 * Enforce cross-origin rules. A preflight that matches no flow is answered
 * by the plugin's edge handler; matched responses get their CORS headers
 * at `onResponse`. A denied preflight returns `204` **without** CORS
 * headers — the browser blocks it, which is the correct, quiet failure.
 *
 * Accepts static options or a {@link ConfigSource} for DB-driven origin
 * lists (open an emergency integration origin without a redeploy).
 *
 * @param options - Origin rules and friends, or a config source
 */
export function cors(options: CorsOptions | ConfigSource<CorsOptions> = {}): PluginDef {
  const def = plugin("cors", { version: "0.0.1", config: pluginConfigSnapshot(options) })
    .edge((request, info) => {
      if (!isPreflight(request, info.method)) return undefined;
      const resolved = resolvePluginOptions(options);
      const origin = request.headers.get("origin")!;
      if (!originAllowed(origin, resolved.origin)) {
        return new Response(null, { status: 204 });
      }

      const headers = new Headers();
      headers.set("access-control-allow-origin", allowOriginValue(origin, resolved));
      headers.set("access-control-allow-methods", (resolved.methods ?? DEFAULT_METHODS).join(", "));
      const allowed =
        resolved.allowedHeaders?.join(", ") ??
        request.headers.get("access-control-request-headers");
      if (allowed !== null && allowed !== undefined && allowed.length > 0) {
        headers.set("access-control-allow-headers", allowed);
      }
      if (resolved.credentials === true) headers.set("access-control-allow-credentials", "true");
      if (resolved.maxAge !== undefined)
        headers.set("access-control-max-age", String(resolved.maxAge));
      appendVary(headers, "origin");
      appendVary(headers, "access-control-request-method");
      appendVary(headers, "access-control-request-headers");
      return new Response(null, { status: 204, headers });
    })
    .hook("onResponse", (ctx) => {
      if (!ctx.request || !ctx.response) return;
      const origin = ctx.request.headers.get("origin");
      if (origin === null) return;
      const resolved = resolvePluginOptions(options);
      if (!originAllowed(origin, resolved.origin)) return;

      ctx.response = withHeaders(ctx.response, (headers) => {
        headers.set("access-control-allow-origin", allowOriginValue(origin, resolved));
        if (resolved.credentials === true) headers.set("access-control-allow-credentials", "true");
        if (resolved.exposedHeaders !== undefined && resolved.exposedHeaders.length > 0) {
          headers.set("access-control-expose-headers", resolved.exposedHeaders.join(", "));
        }
        appendVary(headers, "origin");
      });
    });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
