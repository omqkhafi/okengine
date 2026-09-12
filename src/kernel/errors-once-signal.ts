/**
 * OKE1071 — kept off the kernel edge profile.
 *
 * Two different Flows bound to the same `signal.once` throw this at `oke()`
 * construction. Extract fails the same collision with a plain `Error`
 * (`OKE1071` in the message) so `okengine/compiler` stays off this module.
 * `oke()` imports it directly (that graph is not in `budget-entry`).
 * Registry discovery includes this file; the edge `lookupOkeError` path
 * stays off this def.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/**
 * Two different Flow definitions share one `signal.once` consumer slot.
 *
 * Horizontal replicas of the same Flow are one `on()` in source — this only
 * fires when the Manifest lists two or more Flow names on that signal.
 */
export const ONCE_SIGNAL_MULTI_FLOW: OkeErrorDefinition = {
  code: 1071,
  domain: "kernel",
  cause: 'Once signal "{signal}" is bound to more than one Flow ({flows}).',
  fix: "Use signal.broadcast if each flow should independently receive this event, or bind only one flow if these should compete for the same work.",
};
