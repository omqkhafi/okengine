/**
 * Once-shown API key secret — dismissal requires explicit acknowledgement
 * (console §9.14). Not a passing "done" button.
 */

/** State of the once-shown secret dialog. */
export interface OnceSecretState {
  readonly secret: string;
  readonly keyId: string;
  readonly keyName: string;
  readonly acknowledged: boolean;
}

/**
 * Whether the once-shown secret may be dismissed.
 *
 * @param state - Dialog state
 */
export function canDismissOnceSecret(
  state: Pick<OnceSecretState, "acknowledged">,
): boolean {
  return state.acknowledged === true;
}

/**
 * Acknowledgement label — explicit, not a soft "done".
 */
export const ONCE_SECRET_ACK_LABEL =
  "I have copied this secret and understand it will not be shown again";

/**
 * Copy for the once-shown secret surface.
 */
export const ONCE_SECRET_WARNING =
  "This secret is shown exactly once. Store it now — dismissal is permanent.";
