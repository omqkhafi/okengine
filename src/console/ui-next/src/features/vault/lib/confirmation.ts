/**
 * Typed confirmation for vault set / rotate / rotate-master (console §6 · §9.8).
 *
 * There is no preview affordance for Vault — writes are real.
 */

import {
  validateTypedConfirm,
  type StoreConfirmationPattern,
} from "../../store/lib/confirmation.ts";

export { validateTypedConfirm };
export type VaultConfirmationPattern = StoreConfirmationPattern;

/**
 * Confirmation for setting a vault value.
 *
 * @param options - Environment
 */
export function setConfirmation(
  options: { readonly production: boolean } = { production: true },
): VaultConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "SET", requireReason: true };
  }
  return { kind: "undo", windowMs: 15_000 };
}

/**
 * Confirmation for rotating a vault value — always typed (blast radius).
 *
 * @param _options - Reserved for environment flags
 */
export function rotateConfirmation(
  _options: { readonly production: boolean } = { production: true },
): VaultConfirmationPattern {
  return { kind: "typed", phrase: "ROTATE", requireReason: true };
}

/**
 * Confirmation for master-key rotation — always typed (dual-KEK window).
 */
export function rotateMasterConfirmation(): VaultConfirmationPattern {
  return { kind: "typed", phrase: "ROTATE_MASTER", requireReason: true };
}
