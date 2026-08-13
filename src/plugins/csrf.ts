/**
 * Official `csrf` plugin — cross-site request forgery defense using fetch
 * metadata (`Sec-Fetch-Site`) with an `Origin` fallback. Stateless: no
 * tokens, no cookies, no session reads. Uses only the public plugin API.
 */

import { fail } from "../kernel/errors.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  isConfigSource,
  type ConfigSource,
} from "./config-source.ts";

/** Options for {@link csrf}. */
export interface CsrfOptions {
  /**
   * Absolute origins allowed to send mutating requests from another site
   * (e.g. `"https://admin.example.com"` for a separately-hosted console).
   * Same-origin is always allowed.
   */
  readonly allowOrigins?: readonly string[];
  /**
   * Allow `Sec-Fetch-Site: same-site` (subdomains of your site). Default
   * `true`. Set `false` when subdomains host untrusted content.
   */
  readonly allowSameSite?: boolean;
  /**
   * Allow mutating requests carrying neither `Sec-Fetch-Site` nor `Origin`
   * — the shape of curl, server-to-server calls, and webhooks, which are
   * not browser CSRF vectors. Default `true`. Set `false` to fail closed
   * when your auth is purely cookie-based.
   */
  readonly allowNoHeader?: boolean;
}

/** Methods browsers can mutate state with (safe verbs pass untouched). */
function isMutating(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && method !== "QUERY";
}

/**
 * Block cross-site state changes at `onAuth`, before gate policies and the
 * flow body. Decision order: safe methods pass → `Sec-Fetch-Site`
 * (`same-origin` / `none` pass; `same-site` per option) → `Origin`
 * fallback (must be same-origin or allow-listed) → headerless clients per
 * `allowNoHeader`. Denials are the gate element's typed `Forbidden`.
 *
 * Accepts static options or a {@link ConfigSource} for DB-driven origin
 * rules.
 *
 * @param options - Origin rules, or a config source
 */
export function csrf(options: CsrfOptions | ConfigSource<CsrfOptions> = {}): PluginDef {
  const def = plugin("csrf", { version: "0.0.1", config: pluginConfigSnapshot(options) }).hook(
    "onAuth",
    (ctx) => {
      if (!ctx.request) return;
      const method = ctx.request.method.toUpperCase();
      if (!isMutating(method)) return;

      const resolved = resolvePluginOptions(options);
      const site = ctx.request.headers.get("sec-fetch-site")?.toLowerCase();
      if (site === "same-origin" || site === "none") return;
      if (site === "same-site" && (resolved.allowSameSite ?? true)) return;

      const origin = ctx.request.headers.get("origin");
      if (origin !== null) {
        const host = new URL(ctx.request.url).origin;
        if (origin === host || resolved.allowOrigins?.includes(origin) === true) return;
        return fail("Forbidden", {
          reason: "csrf",
          site: site ?? "unknown",
          origin,
        });
      }

      if (resolved.allowNoHeader ?? true) return;
      return fail("Forbidden", { reason: "csrf", site: site ?? "unknown" });
    },
  );

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
