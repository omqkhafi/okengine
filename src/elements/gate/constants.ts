/**
 * Gate rate-limit constants — kept free of strategy / kv-lua imports so
 * `gate.public` declaration does not pull Lua registration into HTTP-only apps.
 */

import type { RateStrategy } from "../../manifest/types.ts";

/** Default rate strategy (unified-theory §16). */
export const DEFAULT_RATE_STRATEGY: RateStrategy = "sliding-window-counter";

/** All five strategy ids. */
export const ALL_RATE_STRATEGIES: readonly RateStrategy[] = [
  "fixed-window",
  "sliding-window-counter",
  "sliding-log",
  "token-bucket",
  "leaky-bucket",
];
