/**
 * Hybrid sessions — short JWT access + revocable refresh.
 *
 * Refresh tokens rotate on every use. Presenting a previously-used refresh
 * token is reuse detection: the entire token family is revoked.
 *
 * @see docs/spec/unified-theory.md §13 · console.md §9.14
 */

import type { AuthPlane } from "./planes.ts";
import type { RefreshTokenRow, SessionRow } from "./tables.ts";

/** Default access-token TTL (14 minutes — residual validity after revoke). */
export const ACCESS_TTL_MS = 14 * 60 * 1000;

/** Default refresh-token TTL (30 days). */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Session store. */
export interface SessionStore {
  sessions: Map<string, SessionRow>;
  refresh: Map<string, RefreshTokenRow>;
}

/** Issued session bundle. */
export interface IssuedSession {
  readonly session: SessionRow;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: number;
}

/** Access-token claims (unsigned JSON for the builtin path; HMAC below). */
export interface AccessClaims {
  readonly sub: string;
  readonly plane: AuthPlane;
  readonly sid: string;
  readonly scopes: string[];
  readonly iat: number;
  readonly exp: number;
}

/** Options for {@link createSessionStore}. */
export interface SessionCrypto {
  /** HMAC secret for access tokens. */
  readonly secret: string;
  readonly now?: () => number;
  readonly accessTtlMs?: number;
  readonly refreshTtlMs?: number;
}

/**
 * Create an empty session store.
 */
export function createSessionStore(): SessionStore {
  return { sessions: new Map(), refresh: new Map() };
}

/**
 * Issue a hybrid session for a principal.
 *
 * @param store - Session store
 * @param crypto - Signing + TTLs
 * @param principal - Subject
 */
export async function issueSession(
  store: SessionStore,
  crypto: SessionCrypto,
  principal: {
    readonly id: string;
    readonly plane: AuthPlane;
    readonly scopes: Iterable<string>;
  },
): Promise<IssuedSession> {
  const now = crypto.now ?? (() => Date.now());
  const t = now();
  const accessTtl = crypto.accessTtlMs ?? ACCESS_TTL_MS;
  const refreshTtl = crypto.refreshTtlMs ?? REFRESH_TTL_MS;
  const sessionId = cryptoRandomId();
  const familyId = cryptoRandomId();

  const session: SessionRow = {
    id: sessionId,
    plane: principal.plane,
    principalId: principal.id,
    familyId,
    revokedAt: null,
    createdAt: t,
    expiresAt: t + refreshTtl,
  };
  store.sessions.set(sessionId, session);

  const refreshRaw = `rt_${cryptoRandomId()}`;
  const refreshRow: RefreshTokenRow = {
    id: cryptoRandomId(),
    sessionId,
    familyId,
    hash: await hashToken(refreshRaw),
    expiresAt: t + refreshTtl,
    usedAt: null,
    revokedAt: null,
  };
  store.refresh.set(refreshRow.id, refreshRow);

  const accessExpiresAt = t + accessTtl;
  const accessToken = await signAccess(crypto.secret, {
    sub: principal.id,
    plane: principal.plane,
    sid: sessionId,
    scopes: [...principal.scopes],
    iat: t,
    exp: accessExpiresAt,
  });

  return { session, accessToken, refreshToken: refreshRaw, accessExpiresAt };
}

/**
 * Rotate a refresh token. Reuse of an already-used token revokes the family.
 *
 * @param store - Session store
 * @param crypto - Signing + TTLs
 * @param refreshToken - Raw refresh token
 */
export async function rotateRefresh(
  store: SessionStore,
  crypto: SessionCrypto,
  refreshToken: string,
): Promise<IssuedSession> {
  const now = crypto.now ?? (() => Date.now());
  const t = now();
  const hash = await hashToken(refreshToken);
  const existing = [...store.refresh.values()].find((r) => r.hash === hash);

  if (!existing) {
    throw new SessionError("unknown refresh token");
  }

  // Reuse detection: token already consumed → revoke family.
  if (existing.usedAt !== null || existing.revokedAt !== null) {
    revokeFamily(store, existing.familyId, t);
    throw new SessionError("refresh token reuse detected; family revoked");
  }

  const session = store.sessions.get(existing.sessionId);
  if (!session || session.revokedAt !== null) {
    throw new SessionError("session revoked");
  }
  if (existing.expiresAt <= t || session.expiresAt <= t) {
    throw new SessionError("refresh token expired");
  }

  existing.usedAt = t;
  existing.revokedAt = t;

  const accessTtl = crypto.accessTtlMs ?? ACCESS_TTL_MS;
  const refreshTtl = crypto.refreshTtlMs ?? REFRESH_TTL_MS;

  const newRefreshRaw = `rt_${cryptoRandomId()}`;
  const newRefresh: RefreshTokenRow = {
    id: cryptoRandomId(),
    sessionId: session.id,
    familyId: existing.familyId,
    hash: await hashToken(newRefreshRaw),
    expiresAt: t + refreshTtl,
    usedAt: null,
    revokedAt: null,
  };
  store.refresh.set(newRefresh.id, newRefresh);

  // Recover scopes from the previous access path — stored on session via
  // a side map would be ideal; for builtin we re-sign with empty and let
  // callers pass scopes through verify. We keep scopes on a claim cache:
  const priorScopes = sessionScopes.get(session.id) ?? [];
  const accessExpiresAt = t + accessTtl;
  const accessToken = await signAccess(crypto.secret, {
    sub: session.principalId,
    plane: session.plane,
    sid: session.id,
    scopes: priorScopes,
    iat: t,
    exp: accessExpiresAt,
  });

  return {
    session,
    accessToken,
    refreshToken: newRefreshRaw,
    accessExpiresAt,
  };
}

/** Session id → scopes (access-token material). */
const sessionScopes = new Map<string, string[]>();

/**
 * Remember scopes for refresh rotation (call after {@link issueSession}).
 *
 * @param sessionId - Session id
 * @param scopes - Scopes
 */
export function bindSessionScopes(
  sessionId: string,
  scopes: Iterable<string>,
): void {
  sessionScopes.set(sessionId, [...scopes]);
}

/**
 * Issue a session and bind scopes for later rotation.
 *
 * @param store - Session store
 * @param crypto - Crypto
 * @param principal - Subject + scopes
 */
export async function issueSessionWithScopes(
  store: SessionStore,
  crypto: SessionCrypto,
  principal: {
    readonly id: string;
    readonly plane: AuthPlane;
    readonly scopes: Iterable<string>;
  },
): Promise<IssuedSession> {
  const issued = await issueSession(store, crypto, principal);
  bindSessionScopes(issued.session.id, principal.scopes);
  return issued;
}

/**
 * Verify an access token; rejects revoked sessions.
 *
 * @param store - Session store
 * @param secret - HMAC secret
 * @param token - Access token
 * @param now - Clock
 */
export async function verifyAccess(
  store: SessionStore,
  secret: string,
  token: string,
  now: () => number = () => Date.now(),
): Promise<AccessClaims> {
  const claims = await verifyAccessSignature(secret, token);
  if (claims.exp <= now()) {
    throw new SessionError("access token expired");
  }
  const session = store.sessions.get(claims.sid);
  if (!session || session.revokedAt !== null) {
    throw new SessionError("session revoked");
  }
  return claims;
}

/**
 * Revoke an entire refresh-token family (reuse detection / logout).
 *
 * @param store - Session store
 * @param familyId - Family id
 * @param at - Timestamp
 */
export function revokeFamily(
  store: SessionStore,
  familyId: string,
  at: number = Date.now(),
): void {
  for (const session of store.sessions.values()) {
    if (session.familyId === familyId) session.revokedAt = at;
  }
  for (const token of store.refresh.values()) {
    if (token.familyId === familyId) token.revokedAt = at;
  }
}

/** Session / token error. */
export class SessionError extends Error {
  /** @param message - Diagnostic */
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cryptoRandomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function signAccess(
  secret: string,
  claims: AccessClaims,
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = await hmac(secret, data);
  return `${data}.${sig}`;
}

async function verifyAccessSignature(
  secret: string,
  token: string,
): Promise<AccessClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SessionError("malformed access token");
  const [header, payload, sig] = parts as [string, string, string];
  const data = `${header}.${payload}`;
  const expected = await hmac(secret, data);
  if (sig !== expected) throw new SessionError("invalid access token signature");
  return JSON.parse(b64urlDecode(payload)) as AccessClaims;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return b64urlBytes(new Uint8Array(sig));
}

function b64url(s: string): string {
  return b64urlBytes(new TextEncoder().encode(s));
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}
