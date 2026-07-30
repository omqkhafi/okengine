/**
 * Official `ip-allowlist` plugin — client-IP allow/deny rules at the edge
 * of the pipeline. Uses only the public plugin API (unified-theory §14).
 */

import { fail } from "../kernel/errors.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  isConfigSource,
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  type ConfigSource,
} from "./config-source.ts";

/** Options for {@link ipAllowlist}. */
export interface IpAllowlistOptions {
  /**
   * Client IPs permitted to call any flow. When set, every other client
   * gets `Forbidden`. Exact IPv4/IPv6 strings.
   */
  readonly allow?: readonly string[];
  /**
   * Client IPs blocked from calling any flow. Checked before `allow`, so
   * a deny always wins on overlap.
   */
  readonly deny?: readonly string[];
  /**
   * Header carrying the client IP. Default `"x-forwarded-for"` (first hop
   * wins, the value your proxy appends). Only trustworthy behind a proxy
   * that sets or overwrites this header — a direct client can lie.
   */
  readonly header?: string;
}

/** Extract the client IP from the configured header (first hop for XFF). */
function clientIp(request: Request, header: string): string | undefined {
  const raw = request.headers.get(header);
  if (raw === null) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
}

/**
 * Enforce IP allow/deny rules at `onAuth`, before any gate policy or flow
 * body runs. Denied clients get the same typed `Forbidden` denial the gate
 * element produces. A missing/empty IP header is denied when `allow` is
 * set, permitted otherwise. Non-HTTP triggers no-op.
 *
 * Accepts static options or a {@link ConfigSource} — block an abusive IP
 * from the database and have every instance pick it up on the next sync.
 *
 * @param options - Allow/deny lists and header name, or a config source
 */
export function ipAllowlist(
  options: IpAllowlistOptions | ConfigSource<IpAllowlistOptions>,
): PluginDef {
  const def = plugin("ip-allowlist", {
    version: "0.0.2",
    config: pluginConfigSnapshot(options),
  }).hook("onAuth", (ctx) => {
    if (!ctx.request) return;
    const resolved = resolvePluginOptions(options);
    const header = (resolved.header ?? "x-forwarded-for").toLowerCase();
    const ip = clientIp(ctx.request, header);

    if (ip !== undefined && (resolved.deny ?? []).includes(ip)) {
      return fail("Forbidden", { reason: "ip_denied", ip });
    }
    if (resolved.allow !== undefined && (ip === undefined || !resolved.allow.includes(ip))) {
      return fail("Forbidden", { reason: "ip_not_allowed", ip });
    }
  });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
