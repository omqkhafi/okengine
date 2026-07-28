/**
 * Reversibility-governed confirmation for Store actions (console §10.5 · §9.5).
 *
 * Direct edit / delete / purge are irreversible in production — typed confirm.
 */

import { UNDO_WINDOW_MS, type ConfirmationPattern } from "../flows/confirmation.ts";

export { UNDO_WINDOW_MS, validateTypedConfirm } from "../flows/confirmation.ts";
export type { ConfirmationPattern } from "../flows/confirmation.ts";

/**
 * Confirmation for a direct row/key edit (not a flow execution).
 *
 * @param options - Environment
 */
export function editConfirmation(
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "EDIT", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/**
 * Confirmation for deleting rows/keys.
 *
 * @param options - Environment
 */
export function deleteConfirmation(
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "DELETE", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/**
 * Confirmation for purging a cache namespace.
 *
 * @param options - Environment
 */
export function purgeConfirmation(
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "PURGE", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}
