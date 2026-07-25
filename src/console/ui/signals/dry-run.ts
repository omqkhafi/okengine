/**
 * Dry-run safety for Signals — mirrors Traces' reversibility model (console §9.4 · §9.3).
 *
 * Dry run is safe by definition: send/ask are stubbed through `fx` ALS;
 * unknown consumer shapes are refused rather than silently risked.
 */

import type { SignalRecord } from "./types.ts";

/** Whether the panel may offer dry-run for this signal. */
export type DryRunOffer =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Decide whether dry-run is offered — same refusal spirit as Traces.
 *
 * @param signal - Projected signal row
 */
export function dryRunOffer(signal: SignalRecord): DryRunOffer {
  if (signal.orphaned) {
    return {
      ok: false,
      reason:
        "Orphaned signal — consumer shape unknown; dry-run refused rather than risk a side effect.",
    };
  }
  if (signal.consumers.length === 0) {
    return {
      ok: false,
      reason:
        "No Manifest consumer — dry-run refused rather than invoke an unknown handler unsafely.",
    };
  }
  return { ok: true };
}
