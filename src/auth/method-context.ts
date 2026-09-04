/**
 * Active Gate auth context for method plugins plugged on the same app.
 *
 * Set during `oke({ gate: { auth } })` so `.plug(username())` etc. share
 * the app session store, HMAC secret, password policy, hash knobs, and
 * breach check without callers re-passing them.
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import type { BreachCheckFn } from "./breach-check.ts";
import type { IdentityStore } from "./identity.ts";
import type { PasswordPolicyOptions } from "./password-policy.ts";
import type { SessionStore } from "./sessions.ts";
import type {
  PendingTwoFactorStore,
  StepUpStore,
  TwoFactorRequiredOut,
} from "./two-factor-challenge.ts";
import type { VerificationStore } from "./verification.ts";

/**
 * Bridge registered by `twoFactor()` so first-factor sign-in can withhold
 * tokens and issue a method-locked pending challenge.
 */
export interface TwoFactorAuthBridge {
  /** Whether the user has an enabled second factor. */
  isEnabled(userId: string): boolean;
  /**
   * Issue a locked login challenge (and email OTP when method is email_otp).
   * Returns null when 2FA is not enabled for the user.
   */
  beginLoginChallenge(userId: string): Promise<TwoFactorRequiredOut | null>;
}

/** Shared context for auth method plugins. */
export interface ActiveGateAuthContext {
  readonly secret: string;
  readonly sessions: SessionStore;
  /** Shared identity/credential store — method plugins resolve users here. */
  readonly identities?: IdentityStore;
  readonly now?: () => number;
  /** From `gate.auth.passwordPolicy` — shared by credential method plugins. */
  readonly passwordPolicy?: PasswordPolicyOptions;
  /** From `gate.auth.password` — Bun.password cost knobs. */
  readonly password?: PasswordHashOptions;
  /** From `gate.auth.breachCheck` — optional breach checker. */
  readonly breachCheck?: BreachCheckFn;
  /** Shared pending login 2FA challenges (created at Gate auth wire). */
  readonly pendingTwoFactor?: PendingTwoFactorStore;
  /** Shared step-up grants for privileged 2FA ops. */
  readonly stepUp?: StepUpStore;
  /** Shared verification store for 2FA email OTP (and injectable tests). */
  readonly twoFactorVerifications?: VerificationStore;
  /** Registered by `.plug(twoFactor())`. */
  twoFactor?: TwoFactorAuthBridge;
}

let active: ActiveGateAuthContext | undefined;

/**
 * Publish the app's Gate auth binding for subsequent `.plug()` method plugins.
 *
 * @param ctx - Shared auth material, or undefined to clear
 */
export function setActiveGateAuthContext(ctx: ActiveGateAuthContext | undefined): void {
  active = ctx;
}

/**
 * Read the active Gate auth context, if any.
 */
export function getActiveGateAuthContext(): ActiveGateAuthContext | undefined {
  return active;
}

/**
 * Mutate the active context in place (e.g. register `twoFactor` bridge).
 *
 * @param patch - Fields to merge onto the active context
 */
export function patchActiveGateAuthContext(
  patch: Partial<ActiveGateAuthContext>,
): ActiveGateAuthContext | undefined {
  if (!active) return undefined;
  active = { ...active, ...patch };
  return active;
}
