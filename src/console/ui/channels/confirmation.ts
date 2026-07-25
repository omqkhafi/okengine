/**
 * Reversibility-governed confirmation for Channel send-test (console §10.5 · §9.9).
 *
 * Send test is a real external send — typed confirm in production, never stubbed.
 */

import {
  UNDO_WINDOW_MS,
  type ConfirmationPattern,
} from "../flows/confirmation.ts";

export { UNDO_WINDOW_MS, validateTypedConfirm } from "../flows/confirmation.ts";
export type { ConfirmationPattern } from "../flows/confirmation.ts";

/**
 * Confirmation for a real send-test.
 *
 * @param options - Environment
 */
export function sendTestConfirmation(
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "SEND", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}
