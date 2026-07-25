/**
 * Reversibility-governed confirmation for signal replay / discard (console §10.5).
 *
 * - Reversible (durable consumer, no external) → undo window.
 * - Replay that re-triggers an external effect → typed confirmation + reason.
 */

import {
  UNDO_WINDOW_MS,
  type ConfirmationPattern,
} from "../flows/confirmation.ts";
import type { SignalRecord } from "./types.ts";

export { UNDO_WINDOW_MS, validateTypedConfirm } from "../flows/confirmation.ts";
export type { ConfirmationPattern } from "../flows/confirmation.ts";

/**
 * Confirmation for replaying dead letters of a signal.
 *
 * @param signal - Signal row
 * @param options - Environment
 */
export function replayConfirmation(
  signal: SignalRecord,
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  const retriggersExternal =
    options.production &&
    signal.consumers.some((c) => c.external) &&
    signal.consumersDurable !== true;
  if (retriggersExternal) {
    return {
      kind: "typed",
      phrase: "REPLAY",
      requireReason: true,
    };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/**
 * Confirmation for discarding dead letters.
 *
 * @param signal - Signal row
 * @param options - Environment
 */
export function discardConfirmation(
  signal: SignalRecord,
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  const irreversible =
    options.production &&
    (signal.consumers.some((c) => c.external || !c.durable) ||
      signal.dead > 0);
  if (irreversible) {
    return {
      kind: "typed",
      phrase: "DISCARD",
      requireReason: true,
    };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}
