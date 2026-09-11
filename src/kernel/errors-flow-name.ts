/**
 * OKE1070 — kept off the kernel edge profile.
 *
 * Duplicate Flow names throw this at `oke()` construction. `oke()` imports
 * it directly (that graph is not in `budget-entry`). Registry discovery
 * includes this file; the edge `lookupOkeError` path stays off this def.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Two Flow definitions share the same Manifest / `fx.call` name. */
export const FLOW_NAME_DUPLICATE: OkeErrorDefinition = {
  code: 1070,
  domain: "kernel",
  cause: 'Flow "{flow}" is defined twice.',
  fix: 'Give at least one Flow an explicit flow("…") or a distinct tree export.',
};
