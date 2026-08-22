/**
 * Bearer → principal resolution via the builtin hybrid session path.
 *
 * Production HTTP requests must call {@link verifyAccess} (HMAC signature,
 * expiry, session not revoked). Test-harness principal injection is gated
 * separately in the pipeline (`allowTestPrincipals`).
 */

import { authenticateApiKey, clientIpFromRequest, type ApiKeyStore } from "../auth/api-keys.ts";
import type { ApiKeyRow } from "../auth/tables.ts";
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
export function createAppAuthBinding(options: CreateAppAuthBindingOptions): AppAuthBinding {
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
  const claims = await verifyAccess(auth.sessions, auth.secret, token, auth.now);
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
    ...(claims.tid !== undefined ? { tenantId: claims.tid } : {}),
  };
}

/**
 * Map an authenticated API key row to the pipeline principal shape.
 *
 * The key is the issuer with fewer gates: `userId` / `operatorId` is
 * {@link ApiKeyRow.creatorId}. The credential id is {@link ResolvedPrincipal.apiKeyId}.
 *
 * @param row - Authenticated key
 */
export function apiKeyRowToPrincipal(row: ApiKeyRow): ResolvedPrincipal {
  if (row.plane === "operator") {
    return {
      plane: "operator",
      operatorId: row.creatorId,
      userId: null,
      scopes: row.scopes,
      verified: true,
      apiKeyId: row.id,
      ...(row.tenantId !== undefined ? { tenantId: row.tenantId } : {}),
    };
  }
  return {
    plane: "user",
    userId: row.creatorId,
    scopes: row.scopes,
    verified: true,
    apiKeyId: row.id,
    ...(row.tenantId !== undefined ? { tenantId: row.tenantId } : {}),
  };
}

/**
 * Verify a Bearer token as a session JWT, then as an API key when a store is bound.
 *
 * @param auth - Session binding
 * @param token - Raw Bearer token
 * @param apiKeys - Optional key store
 * @param request - Incoming request (allowlist IP is read here, not in `oke()`)
 */
export async function verifyBearerOrApiKey(
  auth: AppAuthBinding,
  token: string,
  apiKeys?: ApiKeyStore,
  request?: Request,
): Promise<ResolvedPrincipal> {
  try {
    return await verifyBearerToken(auth, token);
  } catch (err) {
    if (apiKeys) {
      const ip = request ? clientIpFromRequest(request) : undefined;
      const row = await authenticateApiKey(apiKeys, token, { now: auth.now, ip });
      if (row) return apiKeyRowToPrincipal(row);
    }
    throw err;
  }
}
