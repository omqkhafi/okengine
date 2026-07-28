/**
 * `console:flows:invoke-as` — attenuated exactly like an API key.
 *
 * An operator cannot assume a scope set they could not grant.
 * Impersonating a real user is development-only.
 *
 * @see docs/spec/console.md §10.4
 */

import { assertAttenuated } from "./attenuation.ts";
import { userPrincipal, type UserPrincipal } from "./planes.ts";

/** Options for invoke-as. */
export interface InvokeAsOptions {
  /** Operator's own scopes (attenuation ceiling). */
  readonly operatorScopes: ReadonlySet<string> | Iterable<string>;
  /** Requested application scopes for the assumed principal. */
  readonly scopes: readonly string[];
  /** Synthetic user id (required). */
  readonly userId: string;
  /**
   * When true, allows binding to a real identity id.
   * Impersonating a real user is development-only.
   */
  readonly impersonateRealUser?: boolean;
  /** Production / development flag. */
  readonly development?: boolean;
}

/**
 * Build an attenuated user principal for console invoke-as.
 *
 * @param options - Operator ceiling + requested scopes
 */
export function invokeAs(options: InvokeAsOptions): UserPrincipal {
  assertAttenuated(options.operatorScopes, options.scopes, "invoke-as");

  if (options.impersonateRealUser && !options.development) {
    throw new Error("invoke-as: impersonating a real user is development-only");
  }

  return userPrincipal({
    userId: options.userId,
    scopes: options.scopes,
    verified: true,
  });
}
