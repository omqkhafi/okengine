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
  /**
   * Intended audience (`oke-console` · `oke-mcp` · `oke-app`).
   * Validated when the verifier supplies {@link VerifyAccessOptions.audience}.
   */
  readonly aud?: string;
  /**
   * Active tenant for this access token (request-scoped).
   * Never stored on the session row — switching issues a new token pair.
   */
  readonly tid?: string;
}

/** Options for {@link createSessionStore}. */
export interface SessionCrypto {
  /** HMAC secret for access tokens. */
  readonly secret: string;
  readonly now?: () => number;
  readonly accessTtlMs?: number;
  readonly refreshTtlMs?: number;
  /**
   * Idle timeout — reject refresh when `now - lastActiveAt > idleTtlMs`.
   * Opt-in (undefined = disabled).
   */
  readonly idleTtlMs?: number;
  /**
   * Absolute lifetime from `session.createdAt` (hard stop even if refresh would extend).
   * Opt-in; when set should be ≤ refreshTtlMs.
   */
  readonly absoluteTtlMs?: number;
  /**
   * When true, issuing a session revokes other active families for the same principal.
   * Opt-in (default false).
   */
  readonly singleSessionPerUser?: boolean;
  /**
   * Audience stamped on issued access tokens.
   * MCP tokens must use `"oke-mcp"` (console §10.3 — never accept another aud).
   */
  readonly audience?: string;
}

/** Options for {@link verifyAccess}. */
export interface VerifyAccessOptions {
  /** Clock (defaults to `Date.now`). */
  readonly now?: () => number;
  /**
   * When set, the token's `aud` must match exactly.
   * Tokens minted for another audience (or missing `aud`) are rejected.
   */
  readonly audience?: string;
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
    /** Optional tenant claim (not stored on the session row). */
    readonly tenantId?: string | null;
  },
): Promise<IssuedSession> {
  const now = crypto.now ?? (() => Date.now());
  const t = now();
  const accessTtl = crypto.accessTtlMs ?? ACCESS_TTL_MS;
  const refreshTtl = crypto.refreshTtlMs ?? REFRESH_TTL_MS;
  const absoluteCap =
    crypto.absoluteTtlMs !== undefined ? Math.min(refreshTtl, crypto.absoluteTtlMs) : refreshTtl;
  const sessionId = cryptoRandomId();
  const familyId = cryptoRandomId();

  if (crypto.singleSessionPerUser) {
    revokePrincipalSessions(store, principal.plane, principal.id, t);
  }

  const session: SessionRow = {
    id: sessionId,
    plane: principal.plane,
    principalId: principal.id,
    familyId,
    revokedAt: null,
    createdAt: t,
    expiresAt: t + absoluteCap,
    lastActiveAt: t,
    scopes: [...principal.scopes],
    ...(crypto.audience !== undefined ? { audience: crypto.audience } : {}),
  };
  store.sessions.set(sessionId, session);

  const refreshRaw = `rt_${cryptoRandomId()}`;
  const tid = principal.tenantId ?? undefined;
  const refreshRow: RefreshTokenRow = {
    id: cryptoRandomId(),
    sessionId,
    familyId,
    hash: await hashToken(refreshRaw),
    expiresAt: t + refreshTtl,
    usedAt: null,
    revokedAt: null,
    ...(tid !== undefined && tid !== "" ? { tid } : {}),
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
    ...(crypto.audience !== undefined ? { aud: crypto.audience } : {}),
    ...(tid !== undefined && tid !== "" ? { tid } : {}),
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
  if (crypto.absoluteTtlMs !== undefined && session.createdAt + crypto.absoluteTtlMs <= t) {
    throw new SessionError("session absolute lifetime exceeded");
  }
  const lastActive = session.lastActiveAt ?? session.createdAt;
  if (crypto.idleTtlMs !== undefined && lastActive + crypto.idleTtlMs <= t) {
    throw new SessionError("session idle timeout exceeded");
  }

  existing.usedAt = t;
  existing.revokedAt = t;
  session.lastActiveAt = t;

  const accessTtl = crypto.accessTtlMs ?? ACCESS_TTL_MS;
  const refreshTtl = crypto.refreshTtlMs ?? REFRESH_TTL_MS;

  const newRefreshRaw = `rt_${cryptoRandomId()}`;
  const rotatedTid = existing.tid;
  const newRefresh: RefreshTokenRow = {
    id: cryptoRandomId(),
    sessionId: session.id,
    familyId: existing.familyId,
    hash: await hashToken(newRefreshRaw),
    expiresAt: t + refreshTtl,
    usedAt: null,
    revokedAt: null,
    ...(rotatedTid !== undefined && rotatedTid !== null && rotatedTid !== ""
      ? { tid: rotatedTid }
      : {}),
  };
  store.refresh.set(newRefresh.id, newRefresh);

  const accessExpiresAt = t + accessTtl;
  const accessToken = await signAccess(crypto.secret, {
    sub: session.principalId,
    plane: session.plane,
    sid: session.id,
    scopes: session.scopes,
    iat: t,
    exp: accessExpiresAt,
    ...(session.audience !== undefined ? { aud: session.audience } : {}),
    ...(rotatedTid !== undefined && rotatedTid !== null && rotatedTid !== ""
      ? { tid: rotatedTid }
      : {}),
  });

  return {
    session,
    accessToken,
    refreshToken: newRefreshRaw,
    accessExpiresAt,
  };
}

/**
 * Remember scopes for refresh rotation (call after {@link issueSession}).
 * Scopes live on the session row — shared with any store hydrate/persist path.
 *
 * @param store - Session store
 * @param sessionId - Session id
 * @param scopes - Scopes
 */
export function bindSessionScopes(
  store: SessionStore,
  sessionId: string,
  scopes: Iterable<string>,
): void {
  const session = store.sessions.get(sessionId);
  if (!session) return;
  // Mutate in place — SessionRow is a store-owned mutable row.
  (session as { scopes: string[] }).scopes = [...scopes];
}

/**
 * Remember audience for refresh rotation (call after {@link issueSession}).
 *
 * @param store - Session store
 * @param sessionId - Session id
 * @param audience - Audience claim
 */
export function bindSessionAudience(
  store: SessionStore,
  sessionId: string,
  audience: string,
): void {
  const session = store.sessions.get(sessionId);
  if (!session) return;
  (session as { audience?: string }).audience = audience;
}

/**
 * Issue a session with scopes (and optional audience) on the session row.
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
    readonly tenantId?: string | null;
  },
): Promise<IssuedSession> {
  return issueSession(store, crypto, principal);
}

/**
 * Verify an access token; rejects revoked sessions and wrong audiences.
 *
 * The third argument may be a clock function (legacy) or
 * {@link VerifyAccessOptions}. Prefer the options form when validating
 * audience (console §10.3 — never accept a token minted for another surface).
 *
 * @param store - Session store
 * @param secret - HMAC secret
 * @param token - Access token
 * @param nowOrOptions - Clock, or options including expected audience
 */
export async function verifyAccess(
  store: SessionStore,
  secret: string,
  token: string,
  nowOrOptions: (() => number) | VerifyAccessOptions = () => Date.now(),
): Promise<AccessClaims> {
  const options: VerifyAccessOptions =
    typeof nowOrOptions === "function" ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? (() => Date.now());
  const claims = await verifyAccessSignature(secret, token);
  if (claims.exp <= now()) {
    throw new SessionError("access token expired");
  }
  if (options.audience !== undefined) {
    if (claims.aud !== options.audience) {
      throw new SessionError(`access token audience mismatch: expected ${options.audience}`);
    }
  }
  const session = store.sessions.get(claims.sid);
  if (!session || session.revokedAt !== null) {
    throw new SessionError("session revoked");
  }
  // Per-request: session must still belong to the token subject.
  if (session.principalId !== claims.sub) {
    throw new SessionError("session does not belong to requester");
  }
  // Touch idle clock on successful access verify.
  session.lastActiveAt = now();
  return claims;
}

/**
 * Revoke an entire refresh-token family (reuse detection / logout).
 *
 * @param store - Session store
 * @param familyId - Family id
 * @param at - Timestamp
 */
export function revokeFamily(store: SessionStore, familyId: string, at: number = Date.now()): void {
  for (const session of store.sessions.values()) {
    if (session.familyId === familyId) session.revokedAt = at;
  }
  for (const token of store.refresh.values()) {
    if (token.familyId === familyId) token.revokedAt = at;
  }
}

/**
 * Revoke all active sessions for a principal (single-session-per-user).
 *
 * @param store - Session store
 * @param plane - Auth plane
 * @param principalId - Subject id
 * @param at - Timestamp
 */
export function revokePrincipalSessions(
  store: SessionStore,
  plane: AuthPlane,
  principalId: string,
  at: number = Date.now(),
): void {
  for (const session of store.sessions.values()) {
    if (
      session.plane === plane &&
      session.principalId === principalId &&
      session.revokedAt === null
    ) {
      revokeFamily(store, session.familyId, at);
    }
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

/** Compact JWS algorithm for session access tokens (HMAC-SHA256). */
const ACCESS_TOKEN_ALG = "HS256" as const;

async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cryptoRandomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function signAccess(secret: string, claims: AccessClaims): Promise<string> {
  const header = b64url(JSON.stringify({ alg: ACCESS_TOKEN_ALG, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = await hmac(secret, data);
  return `${data}.${sig}`;
}

async function verifyAccessSignature(secret: string, token: string): Promise<AccessClaims> {
  const parts = token.split(".");
  // JWS compact = 3 parts; JWE compact = 5 — reject anything else before crypto.
  if (parts.length !== 3) throw new SessionError("malformed access token");
  const [headerPart, payload, sig] = parts as [string, string, string];
  let header: { alg?: string };
  try {
    header = JSON.parse(b64urlDecode(headerPart)) as { alg?: string };
  } catch {
    throw new SessionError("malformed access token header");
  }
  if (header.alg !== ACCESS_TOKEN_ALG) {
    throw new SessionError("unsupported access token alg");
  }
  const data = `${headerPart}.${payload}`;
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
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
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
