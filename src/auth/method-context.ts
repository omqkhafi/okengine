/**
 * Active Gate auth context for method plugins plugged on the same app.
 *
 * Set during `oke({ gate: { auth } })` so `.plug(username())` etc. share
 * the app session store + HMAC secret without callers re-passing them.
 */

import type { SessionStore } from "./sessions.ts";

/** Shared context for auth method plugins. */
export interface ActiveGateAuthContext {
  readonly secret: string;
  readonly sessions: SessionStore;
  readonly now?: () => number;
}

let active: ActiveGateAuthContext | undefined;

/**
 * Publish the app's Gate auth binding for subsequent `.plug()` method plugins.
 *
 * @param ctx - Secret + sessions (or undefined to clear)
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
