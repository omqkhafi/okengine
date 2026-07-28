/**
 * Typed confirmation for vault set / rotate (console §6 · §9.8).
 *
 * There is no preview affordance for Vault — set and rotate are real writes.
 */

import { type ConfirmationPattern, validateTypedConfirm } from "../flows/confirmation.ts";

export { validateTypedConfirm };
export type { ConfirmationPattern };

/**
 * Confirmation for setting a vault value.
 *
 * @param options - Environment
 */
export function setConfirmation(
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "SET", requireReason: true };
  }
  // Dev still records a reason-less write; no typed phrase required.
  return { kind: "undo", windowMs: 15_000 };
}

/**
 * Confirmation for rotating a vault value — always typed (blast radius).
 *
 * @param _options - Reserved for environment flags
 */
export function rotateConfirmation(
  _options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  return { kind: "typed", phrase: "ROTATE", requireReason: true };
}
