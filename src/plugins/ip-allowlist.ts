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
   * Header carrying the client IP. Default `"x-forwarded-for"`.
   *
   * For XFF, reverse proxies (nginx `$proxy_add_x_forwarded_for`, etc.)
   * **append** the connecting peer — they do not overwrite. The trusted
   * client IP is therefore taken from the **right** of the chain (see
   * {@link IpAllowlistOptions.trustedProxyDepth}), not the left. A client
   * connecting directly can still forge the whole header; this plugin is
   * only trustworthy behind a proxy that appends (or sets) it.
   */
  readonly header?: string;
  /**
   * How many trusted proxies sit in front of the app and append to XFF.
   * Default `1` (single reverse proxy — the usual docker / edge shape).
   *
   * The client IP is the hop `trustedProxyDepth` entries from the right:
   * depth `1` = last hop (what the nearest proxy observed); depth `2` =
   * second-from-last (CDN + internal LB both appending), and so on.
   *
   * **This must match the real number of trusted proxies in your
   * deployment.** Too low trusts a spoofable left-side hop; too high may
   * pick a proxy address instead of the client. Wrong depth bypasses the
   * allowlist — this is a topology-dependent security control, not a
   * drop-in default you can ignore.
   */
  readonly trustedProxyDepth?: number;
}

/**
 * Reject a non-positive or non-integer `trustedProxyDepth`.
 * Fail loud at construction (and again if runtime config introduces it).
 */
function assertSafeIpAllowlistOptions(options: IpAllowlistOptions): void {
  const depth = options.trustedProxyDepth;
  if (depth === undefined) return;
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(
      `ip-allowlist: trustedProxyDepth must be an integer >= 1 (got ${String(depth)}) — ` +
        "set it to the real number of trusted proxies that append X-Forwarded-For",
    );
  }
}

/**
 * Extract the client IP from the configured header.
 *
 * For comma-separated XFF chains, trust the hop `trustedProxyDepth` from
 * the right (nearest trusted proxy's observation at depth 1). Left-side
 * entries are attacker-controlled when clients can set the header before
 * a proxy that appends. Fewer hops than `trustedProxyDepth` → undefined
 * (fail closed).
 */
function clientIp(request: Request, header: string, trustedProxyDepth: number): string | undefined {
  const raw = request.headers.get(header);
  if (raw === null) return undefined;
  const hops = raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  if (hops.length === 0) return undefined;
  const index = hops.length - trustedProxyDepth;
  if (index < 0) return undefined;
  return hops[index];
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
  assertSafeIpAllowlistOptions(pluginConfigSnapshot(options));

  const def = plugin("ip-allowlist", {
    version: "0.0.3",
    config: pluginConfigSnapshot(options),
  }).hook("onAuth", (ctx) => {
    if (!ctx.request) return;
    const resolved = resolvePluginOptions(options);
    assertSafeIpAllowlistOptions(resolved);
    const header = (resolved.header ?? "x-forwarded-for").toLowerCase();
    const depth = resolved.trustedProxyDepth ?? 1;
    const ip = clientIp(ctx.request, header, depth);

    if (ip !== undefined && (resolved.deny ?? []).includes(ip)) {
      return fail("Forbidden", { reason: "ip_denied", ip });
    }
    if (resolved.allow !== undefined && (ip === undefined || !resolved.allow.includes(ip))) {
      return fail("Forbidden", { reason: "ip_not_allowed", ip });
    }
  });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
