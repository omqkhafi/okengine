/**
 * MCP session binding — per-request validation (console §10.3).
 *
 * - Cryptographically random, non-sequential session IDs
 * - Every request re-validates that the session belongs to the requester
 * - Token audience must be `oke-mcp` (never accept Console/app tokens)
 * - The caller's token is never forwarded upstream
 */

import {
  issueSessionWithScopes,
  verifyAccess,
  SessionError,
  type AccessClaims,
  type IssuedSession,
  type SessionStore,
} from "../auth/sessions.ts";
import type { AuthPlane } from "../auth/planes.ts";

/** Audience claim required on every MCP access token. */
export const MCP_AUDIENCE = "oke-mcp" as const;

/** Other known audiences — rejected by MCP. */
export const FOREIGN_AUDIENCES = [
  "oke-console",
  "oke-app",
] as const;

/** Verified MCP requester context for one request. */
export interface McpRequester {
  readonly claims: AccessClaims;
  readonly principalId: string;
  readonly plane: AuthPlane;
  readonly scopes: readonly string[];
  readonly sessionId: string;
}

/** Options for minting an MCP operator session. */
export interface MintMcpSessionOptions {
  readonly store: SessionStore;
  readonly secret: string;
  readonly principalId: string;
  readonly scopes: Iterable<string>;
  readonly now?: () => number;
}

/**
 * Mint an operator-plane session whose access token is audience-bound to MCP.
 *
 * @param options - Store, secret, principal
 */
export async function mintMcpSession(
  options: MintMcpSessionOptions,
): Promise<IssuedSession> {
  return issueSessionWithScopes(
    options.store,
    {
      secret: options.secret,
      now: options.now,
      audience: MCP_AUDIENCE,
    },
    {
      id: options.principalId,
      plane: "operator",
      scopes: options.scopes,
    },
  );
}

/**
 * Per-request validation of the Bearer token against the MCP audience and
 * the live session store. Never caches consent or trust across requests.
 *
 * @param store - Session store
 * @param secret - HMAC secret
 * @param token - Raw Bearer token (no prefix)
 * @param now - Clock
 */
export async function authenticateMcpRequest(
  store: SessionStore,
  secret: string,
  token: string,
  now: () => number = () => Date.now(),
): Promise<McpRequester> {
  let claims: AccessClaims;
  try {
    claims = await verifyAccess(store, secret, token, {
      now,
      audience: MCP_AUDIENCE,
    });
  } catch (err) {
    if (err instanceof SessionError) throw err;
    throw new SessionError("MCP authentication failed");
  }

  if (claims.plane !== "operator") {
    throw new SessionError("MCP requires an operator-plane session");
  }

  // Defence in depth: reject known foreign audiences even if verifyAccess
  // somehow ran without the audience option (should be unreachable).
  if (
    claims.aud !== undefined &&
    (FOREIGN_AUDIENCES as readonly string[]).includes(claims.aud)
  ) {
    throw new SessionError(
      `access token audience mismatch: expected ${MCP_AUDIENCE}`,
    );
  }

  return {
    claims,
    principalId: claims.sub,
    plane: claims.plane,
    scopes: claims.scopes,
    sessionId: claims.sid,
  };
}

/**
 * Extract Bearer token from an Authorization header. Returns null when absent.
 *
 * @param header - Authorization header value
 */
export function extractBearer(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Build a cryptographically random MCP transport session id
 * (distinct from the auth `sid` — used for MCP initialize/session binding).
 */
export function newMcpTransportSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mcp_s_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
