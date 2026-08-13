/**
 * Reversibility-governed confirmation for Store mutations (ui-next).
 *
 * Ported from legacy `ui/store/confirmation.ts` + `ui/flows/confirmation.ts`
 * so EDIT/DELETE keep the exact typed-phrase + reason safety pattern.
 */

/** Undo window for reversible actions (non-production). */
export const UNDO_WINDOW_MS = 15_000;

/** Confirmation strategy derived from environment. */
export type StoreConfirmationPattern =
  | { readonly kind: "undo"; readonly windowMs: number }
  | { readonly kind: "typed"; readonly phrase: string; readonly requireReason: true };

/** Confirmation for a direct row/key edit (not a flow execution). */
export function editConfirmation(
  options: { readonly production: boolean } = { production: true },
): StoreConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "EDIT", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/** Confirmation for deleting rows/keys. */
export function deleteConfirmation(
  options: { readonly production: boolean } = { production: true },
): StoreConfirmationPattern {
  if (options.production) {
    return { kind: "typed", phrase: "DELETE", requireReason: true };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/** Operator input for a typed confirmation. */
export interface TypedConfirmInput {
  readonly typed: string;
  readonly reason: string;
  readonly phrase: string;
}

/** Validation errors for typed confirm. */
export interface TypedConfirmErrors {
  readonly typed?: string;
  readonly reason?: string;
}

/**
 * Validate typed confirmation + reason for an irreversible action.
 *
 * Exact match on phrase; reason must be at least 3 characters.
 */
export function validateTypedConfirm(input: TypedConfirmInput): TypedConfirmErrors | null {
  const errors: { typed?: string; reason?: string } = {};
  if (input.typed.trim() !== input.phrase) {
    errors.typed = `Type ${input.phrase} to confirm`;
  }
  if (input.reason.trim().length < 3) {
    errors.reason = "Reason is required (min 3 characters)";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}
