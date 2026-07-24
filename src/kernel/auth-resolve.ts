/**
 * Bearer → principal resolution via the builtin hybrid session path.
 *
 * Production HTTP requests must call {@link verifyAccess} (HMAC signature,
 * expiry, session not revoked). Test-harness principal injection is gated
 * separately in the pipeline (`allowTestPrincipals`).
 */

import {
  createSessionStore,
  verifyAccess,
  type AccessClaims,
  type SessionStore,
} from "../auth/sessions.ts";
import type { ResolvedPrincipal } from "./pipeline.ts";

/** Auth binding for the request pipeline. */
export interface AppAuthBinding {
  /** HMAC secret for access tokens. */
  readonly secret: string;
  /** Session store (revocation checks). Created when omitted. */
  readonly sessions: SessionStore;
  /** Injectable clock (tests / frozen harness). */
  readonly now: () => number;
}

/** Options for {@link createAppAuthBinding}. */
export interface CreateAppAuthBindingOptions {
  readonly secret: string;
  readonly sessions?: SessionStore;
  readonly now?: () => number;
}

/**
 * Create an auth binding that verifies Bearer tokens cryptographically.
 *
 * @param options - Secret + optional session store / clock
 */
export function createAppAuthBinding(
  options: CreateAppAuthBindingOptions,
): AppAuthBinding {
  return {
    secret: options.secret,
    sessions: options.sessions ?? createSessionStore(),
    now: options.now ?? (() => Date.now()),
  };
}

/**
 * Verify a Bearer access token and map claims to a {@link ResolvedPrincipal}.
 * Throws {@link import("../auth/sessions.ts").SessionError} on forge / expiry / revoke.
 *
 * @param auth - App auth binding
 * @param token - Raw Bearer token (no `Bearer ` prefix)
 */
export async function verifyBearerToken(
  auth: AppAuthBinding,
  token: string,
): Promise<ResolvedPrincipal> {
  const claims = await verifyAccess(
    auth.sessions,
    auth.secret,
    token,
    auth.now,
  );
  return claimsToPrincipal(claims);
}

/**
 * Map access-token claims to the pipeline principal shape.
 *
 * A cryptographically valid access token implies an authenticated principal;
 * `verified` is set so policy gates like `member` accept the session.
 *
 * @param claims - Verified claims
 */
export function claimsToPrincipal(claims: AccessClaims): ResolvedPrincipal {
  if (claims.plane === "operator") {
    return {
      plane: "operator",
      operatorId: claims.sub,
      userId: null,
      scopes: claims.scopes,
      verified: true,
    };
  }
  return {
    plane: "user",
    userId: claims.sub,
    scopes: claims.scopes,
    verified: true,
  };
}
