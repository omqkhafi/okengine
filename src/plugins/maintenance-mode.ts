/**
 * Official `maintenance-mode` plugin — drain HTTP traffic with one flag.
 * Uses only the public plugin API (unified-theory §14).
 */

import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  isConfigSource,
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  type ConfigSource,
} from "./config-source.ts";

/** Options for {@link maintenanceMode}. */
export interface MaintenanceModeOptions {
  /**
   * Whether the mode is active. Default `true` — plugging the plugin turns
   * it on. Drive it from the environment to flip without a code change:
   * `enabled: process.env.MAINTENANCE_MODE === "1"`.
   */
  readonly enabled?: boolean;
  /** `Retry-After` value in seconds on the 503. Omitted unless provided. */
  readonly retryAfter?: number;
  /**
   * Path prefixes that keep serving while the mode is active (e.g.
   * `["/health"]` so load-balancer checks stay green).
   */
  readonly allowPaths?: readonly string[];
  /**
   * Operator bypass: requests carrying this header name (any non-empty
   * value) pass through. Presence-based — an ops convenience, not auth.
   */
  readonly bypassHeader?: string;
  /** Failure message in the envelope. Default `"Service is under maintenance."` */
  readonly message?: string;
}

/**
 * Short-circuit every HTTP invocation at `onRequest` with a 503 failure
 * envelope (`ServiceUnavailable`) plus an optional `Retry-After`. Excluded
 * prefixes and the bypass header keep ops paths alive. The 503 still flows
 * through `onResponse`, so response-shaping plugins (security headers,
 * compression) apply to it too. Non-HTTP triggers no-op — clock flows and
 * signal subscribers keep running.
 *
 * Accepts static options or a {@link ConfigSource} — the flagship use
 * case: flip `enabled` from the database and drain traffic without a
 * redeploy.
 *
 * @param options - Flag, retry hint, allow-list, bypass — or a config source
 */
export function maintenanceMode(
  options: MaintenanceModeOptions | ConfigSource<MaintenanceModeOptions> = {},
): PluginDef {
  const def = plugin("maintenance-mode", {
    version: "0.0.2",
    config: pluginConfigSnapshot(options),
  }).hook("onRequest", (ctx) => {
    const resolved = resolvePluginOptions(options);
    if ((resolved.enabled ?? true) === false || !ctx.request) return;
    const message = resolved.message ?? "Service is under maintenance.";

    const { pathname } = new URL(ctx.request.url);
    if (resolved.allowPaths?.some((prefix) => pathname.startsWith(prefix))) return;

    const bypass = resolved.bypassHeader;
    if (bypass !== undefined) {
      const value = ctx.request.headers.get(bypass);
      if (value !== null && value.length > 0) return;
    }

    const headers: Record<string, string> = {};
    if (resolved.retryAfter !== undefined) headers["retry-after"] = String(resolved.retryAfter);
    return Response.json(
      {
        data: null,
        error: { code: "ServiceUnavailable", data: { retryAfter: resolved.retryAfter }, message },
      },
      { status: 503, headers },
    );
  });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
