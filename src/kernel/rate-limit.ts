/**
 * `rateLimit({ max, per })` — convenience unit/app plugin for Provisions.
 */

import { plugin, type PluginDef } from "./plugin.ts";

/** Options for {@link rateLimit}. */
export interface RateLimitPluginOptions {
  /** Max requests in the window. */
  readonly max: number;
  /** Window duration (default `"1m"`). */
  readonly per?: string;
}

/**
 * Create a rate-limit plugin scoped by attachment point.
 *
 * @param options - Max / window
 */
export function rateLimit(options: RateLimitPluginOptions): PluginDef {
  return plugin("rate-limit", {
    version: "1.0.0",
    config: { max: options.max, per: options.per ?? "1m" },
  });
}
