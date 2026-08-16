/**
 * `/` gate surface — claim stays up through first-admin success.
 * Setup closes the instant the operator exists; flipping to Sign in
 * would flash login before `goAfterAuth` enters the shell.
 */

/** Which plate the pre-auth route should render. */
export type AuthGateSurface = "claim" | "login";

/**
 * Pick claim vs login after setup status is known.
 *
 * @param input - Closed setup + whether this tab just claimed
 */
export function authGateSurface(input: {
  readonly setupClosed: boolean;
  readonly claimSucceeded: boolean;
}): AuthGateSurface {
  if (input.claimSucceeded) return "claim";
  return input.setupClosed ? "login" : "claim";
}
