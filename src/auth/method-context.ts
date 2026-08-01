/**
 * Active Gate auth context for method plugins plugged on the same app.
 *
 * Set during `oke({ gate: { auth } })` so `.plug(username())` etc. share
 * the app session store, HMAC secret, password policy, hash knobs, and
 * breach check without callers re-passing them.
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import type { BreachCheckFn } from "./breach-check.ts";
import type { PasswordPolicyOptions } from "./password-policy.ts";
import type { SessionStore } from "./sessions.ts";

/** Shared context for auth method plugins. */
export interface ActiveGateAuthContext {
  readonly secret: string;
  readonly sessions: SessionStore;
  readonly now?: () => number;
  /** From `gate.auth.passwordPolicy` — shared by credential method plugins. */
  readonly passwordPolicy?: PasswordPolicyOptions;
  /** From `gate.auth.password` — Bun.password cost knobs. */
  readonly password?: PasswordHashOptions;
  /** From `gate.auth.breachCheck` — optional breach checker. */
  readonly breachCheck?: BreachCheckFn;
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
