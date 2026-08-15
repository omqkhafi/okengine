/**
 * Call API cache glyph — same traces hit / miss / none marks.
 */

import {
  cacheIconSpec,
  type CacheIconSpec,
  type RunCache,
} from "@/features/flows/traces/cache-icon.ts";

/**
 * Traces cache spec for an invoke envelope.
 *
 * Omitted host `cache` is `none` (not applicable) — never invent a hit.
 *
 * @param cache - Invoke envelope `cache`, when the host reported one
 */
export function invokeCacheSpec(cache: RunCache | undefined): CacheIconSpec {
  const spec = cacheIconSpec(cache ?? "none");
  if ((cache ?? "none") !== "none") return spec;
  return { ...spec, className: "text-muted-foreground" };
}
