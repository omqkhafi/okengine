/**
 * Typed confirmation for Access revoke / rotate (console §10.5 · §9.14).
 *
 * There is no preview / dry-run affordance for Access — B does not apply.
 * Revoke and rotate follow D (irreversible → typed confirm + reason).
 */

import { type ConfirmationPattern, validateTypedConfirm } from "../flows/confirmation.ts";

export { validateTypedConfirm };
export type { ConfirmationPattern };

/**
 * Confirmation for revoking an API key — always typed.
 *
 * @param _options - Reserved
 */
export function revokeConfirmation(
  _options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  return { kind: "typed", phrase: "REVOKE", requireReason: true };
}

/**
 * Confirmation for rotating an API key — always typed.
 *
 * @param _options - Reserved
 */
export function rotateConfirmation(
  _options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  return { kind: "typed", phrase: "ROTATE", requireReason: true };
}
