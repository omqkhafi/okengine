/**
 * Confirmation for vault writes. Set / rotate record a reason.
 * Rotate-master stays a typed phrase (dual-KEK window).
 */

import {
  validateTypedConfirm,
  type StoreConfirmationPattern,
} from "../../store/lib/confirmation.ts";

export { validateTypedConfirm };

/** Confirmation strategy for a vault write. */
export type VaultConfirmationPattern = StoreConfirmationPattern | { readonly kind: "review" };

/**
 * Confirmation for adding a contract from Console — review dialog.
 */
export function createConfirmation(): VaultConfirmationPattern {
  return { kind: "review" };
}

/**
 * Confirmation for setting a vault value — reason + review dialog.
 *
 * @param _options - Reserved for environment flags
 */
export function setConfirmation(
  _options: { readonly production: boolean } = { production: true },
): VaultConfirmationPattern {
  return { kind: "review" };
}

/**
 * Confirmation for rotating a vault value — reason + review dialog.
 *
 * @param _options - Reserved for environment flags
 */
export function rotateConfirmation(
  _options: { readonly production: boolean } = { production: true },
): VaultConfirmationPattern {
  return { kind: "review" };
}

/**
 * Confirmation for master-key rotation — always typed (dual-KEK window).
 */
export function rotateMasterConfirmation(): VaultConfirmationPattern {
  return { kind: "typed", phrase: "ROTATE_MASTER", requireReason: true };
}
