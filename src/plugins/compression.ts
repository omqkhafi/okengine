/**
 * Official `compression` plugin — gzip response bodies for clients that
 * accept it. Uses only the public plugin API (unified-theory §14).
 */

import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  isConfigSource,
  pluginConfigSnapshot,
  resolvePluginOptions,
  withConfigTable,
  type ConfigSource,
} from "./config-source.ts";
import { appendVary } from "./response-headers.ts";

/** Options for {@link compression}. */
export interface CompressionOptions {
  /**
   * Minimum body size in bytes before compression is worth it.
   * Smaller bodies can grow under gzip. Default `1024`.
   */
  readonly minSize?: number;
  /**
   * Which `Content-Type`s to compress. Default matches JSON (including
   * `+json`), JavaScript, XML, and every `text/*`.
   */
  readonly match?: RegExp;
}

/** Default compressible types: JSON, JS, XML, and any text/*. */
const DEFAULT_MATCH = /^(application\/(json|.+\+json|javascript|xml|.+\+xml)|text\/)/i;

/** True when the Accept-Encoding value allows gzip (honoring `q=0`). */
export function acceptsGzip(header: string | null): boolean {
  if (!header) return false;
  for (const part of header.split(",")) {
    const [token, ...params] = part.trim().split(";");
    const name = token!.trim().toLowerCase();
    if (name !== "gzip" && name !== "*") continue;
    const q = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    if (q !== undefined && Number.parseFloat(q.slice(2)) === 0) continue;
    return true;
  }
  return false;
}

/**
 * Compress HTTP response bodies with `Bun.gzipSync` when the client sends
 * `Accept-Encoding: gzip`. Skips: already-encoded responses, `no-transform`
 * cache directives, event streams, non-matching content types, and bodies
 * under `minSize`. Non-HTTP triggers no-op.
 *
 * Accepts static options or a {@link ConfigSource} for DB-driven thresholds.
 *
 * @param options - Size threshold / content-type matcher, or a config source
 */
export function compression(
  options: CompressionOptions | ConfigSource<CompressionOptions> = {},
): PluginDef {
  const def = plugin("compression", {
    version: "0.0.2",
    config: pluginConfigSnapshot(options),
  }).hook("onResponse", async (ctx) => {
    if (!ctx.response || !ctx.request) return;
    const resolved = resolvePluginOptions(options);
    const minSize = resolved.minSize ?? 1024;
    const match = resolved.match ?? DEFAULT_MATCH;
    if (!acceptsGzip(ctx.request.headers.get("accept-encoding"))) return;

    const headers = new Headers(ctx.response.headers);
    if (headers.has("content-encoding")) return;
    const cacheControl = headers.get("cache-control");
    if (cacheControl !== null && /\bno-transform\b/i.test(cacheControl)) return;

    const contentType = headers.get("content-type") ?? "";
    if (!match.test(contentType)) return;

    const body = await ctx.response.arrayBuffer();
    if (body.byteLength < minSize) return;

    const compressed = Bun.gzipSync(new Uint8Array(body));
    headers.set("content-encoding", "gzip");
    headers.delete("content-length");
    appendVary(headers, "accept-encoding");

    ctx.response = new Response(compressed, {
      status: ctx.response.status,
      statusText: ctx.response.statusText,
      headers,
    });
  });

  return isConfigSource(options) ? withConfigTable(def, options) : def;
}
