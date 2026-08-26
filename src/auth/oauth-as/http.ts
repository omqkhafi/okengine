/**
 * Authorization Server HTTP surface — hand-rolled OAuth 2.1 endpoints on
 * the app plane (6530), served through the plugin edge handler so no kernel
 * routing changes are needed.
 *
 * Endpoints (fixed paths):
 * - `GET /.well-known/oauth-authorization-server` (RFC 8414)
 * - `GET /.well-known/oauth-protected-resource`   (RFC 9728)
 * - `GET /oauth/authorize`                        (302 to app consent UI or code redirect)
 * - `POST /oauth/token`                           (authorization_code | refresh_token, DPoP required)
 * - `GET /oauth/jwks`                             (public key set)
 *
 * Security posture (locked decisions):
 * - CIMD client resolution only — no DCR
 * - PKCE S256 mandatory; `resource` (RFC 8707) required on every request
 *   and validated against the configured canonical resource URI
 * - DPoP required on every token grant; issued access tokens carry `cnf.jkt`
 * - Exact `redirect_uri` membership against the fetched metadata
 * - Codes are single-use and SHA-256 hashed at rest
 */

import {
  DPOP_ALG,
  OAUTH_ACCESS_TTL_MS,
  OAUTH_CODE_TTL_MS,
  createDpopSigner,
  decodeDpopProof,
  jwkThumbprint,
  signAccessToken,
  verifyDpopProof,
  type OAuthAccessClaims,
} from "./crypto.ts";
import { OAuthError } from "./errors.ts";
import { resolveCimdClient } from "./cimd.ts";
import { cryptoId, hashSecret } from "./stores.ts";
import type {
  AccessTokenRow,
  AsRefreshTokenRow,
  AuthCodeRow,
  ClientCacheRow,
  ConsentRow,
  PendingAuthorizeRow,
} from "./tables.ts";
import type { AsKeyStore } from "./crypto.ts";

/** Issuer identity + canonical MCP resource URI for one AS instance. */
export interface AsIdentityOptions {
  /** Issuer origin, e.g. `https://api.example.com`. */
  readonly issuer: string;
  /** Canonical RFC 8707 resource URI clients must request, e.g. `https://mcp.example.com/mcp`. */
  readonly resource: string;
}

/** Stores backing the AS (in-memory rows mirroring the declared tables). */
export interface AsStoreBundle {
  readonly keys: AsKeyStore;
  readonly authCodes: Map<string, AuthCodeRow>;
  readonly accessTokens: Map<string, AccessTokenRow>;
  readonly refreshTokens: Map<string, AsRefreshTokenRow>;
  readonly consents: Map<string, ConsentRow>;
  readonly clientCache: Map<string, ClientCacheRow>;
  /** Validated authorize requests awaiting the user's consent decision. */
  readonly pending: Map<string, PendingAuthorizeRow>;
}

/** Options for {@link createOauthAs}. */
export interface OauthAsOptions extends AsIdentityOptions {
  readonly stores: AsStoreBundle;
  readonly now?: () => number;
  /** Injectable CIMD document loader (tests). */
  readonly fetchDoc?: (url: string) => Promise<unknown>;
  /**
   * App consent screen path — authorize redirects unconsented users here
   * with `?consent=<id>` (the developer's own SPA renders the screen).
   */
  readonly consentPath?: string;
  /** Refresh-token TTL (default 14 days). */
  readonly refreshTtlMs?: number;
  /**
   * Resolve the signed-in gate.auth user id from an incoming browser
   * request (cookie/Bearer session) — used by `/oauth/authorize`.
   */
  readonly userFromRequest?: (request: Request) => Promise<string | undefined>;
}

/** Result of an authorize evaluation before any redirect decision. */
export interface AuthorizeEvaluation {
  readonly ok: boolean;
  /** When false, redirect the browser to this error redirect_uri. */
  readonly errorRedirect?: string;
  /** When consent is missing, redirect here (app-built consent screen). */
  readonly consentRedirect?: string;
  /** When ok, redirect here with the fresh code (+state). */
  readonly codeRedirect?: string;
  /** Pending-consent id surfaced to the consent screen / approve Flow. */
  readonly pendingConsentId?: string;
}

const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const JWKS_PATH = "/oauth/jwks";
const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
const PRM_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Build the RFC 8414 authorization-server metadata document.
 *
 * @param issuer - Issuer origin
 * @param resource - Canonical resource URI advertised in `scopes` docs
 */
export function buildAuthorizationServerMetadata(issuer: string): Record<string, unknown> {
  const base = `${issuer.replace(/\/$/, "")}`;
  return {
    issuer: base,
    authorization_endpoint: `${base}${AUTHORIZE_PATH}`,
    token_endpoint: `${base}${TOKEN_PATH}`,
    jwks_uri: `${base}${JWKS_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    dpop_signing_alg_values_supported: [DPOP_ALG],
    scopes_supported: ["openid", "profile", "email", "mcp:tools"],
  };
}

/**
 * Build the RFC 9728 protected-resource metadata document.
 *
 * @param resource - Canonical resource URI
 * @param issuer - AS issuer advertising authorization + token endpoints
 */
export function buildProtectedResourceMetadata(
  resource: string,
  issuer: string,
): Record<string, unknown> {
  const base = `${issuer.replace(/\/$/, "")}`;
  return {
    resource,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}`,
  };
}

/**
 * RFC 6750 / RFC 9728 §5.1 challenge pointing unauthenticated MCP clients
 * at the protected-resource metadata.
 *
 * @param resource - Canonical resource URI
 * @param issuer - AS issuer
 */
export function wwwAuthenticateChallenge(resource: string, _issuer: string): string {
  const prm = `${new URL(resource).origin}${PRM_METADATA_PATH}`;
  return `Bearer resource_metadata="${prm}"`;
}

/**
 * Create the edge handler serving all AS endpoints.
 *
 * @param options - Identity, stores, clock, fetch injection
 */
export function createOauthAs(options: OauthAsOptions): {
  /** Plugin edge handler for the fixed AS paths. */
  edge(
    request: Request,
    info: { readonly method: string; readonly path: string },
  ): Promise<Response | undefined>;
  /** Display data for the app consent screen. */
  describeConsent(pendingId: string): ConsentDescription;
  /** Grant consent + mint the authorization code (session user must match). */
  approveConsent(pendingId: string, userId: string): Promise<{ readonly redirectTo: string }>;
  /** Deny consent — redirects with `error=access_denied`. */
  denyConsent(pendingId: string, userId: string): { readonly redirectTo: string };
} {
  const now = options.now ?? (() => Date.now());
  const refreshTtlMs = options.refreshTtlMs ?? 14 * 24 * 60 * 60_000;
  const stores = options.stores;

  const findPending = (pendingId: string): PendingAuthorizeRow => {
    const row = stores.pending.get(pendingId);
    if (!row || row.expiresAt <= now()) {
      throw new OAuthError("invalid_request", "unknown or expired consent request");
    }
    return row;
  };

  return {
    async edge(request, info) {
      switch (info.path) {
        case AS_METADATA_PATH:
          if (info.method === "GET") {
            return Response.json(buildAuthorizationServerMetadata(options.issuer));
          }
          return undefined;
        case PRM_METADATA_PATH:
          if (info.method === "GET") {
            return Response.json(buildProtectedResourceMetadata(options.resource, options.issuer));
          }
          return undefined;
        case JWKS_PATH:
          if (info.method === "GET") {
            return Response.json(stores.keys.jwks());
          }
          return undefined;
        case TOKEN_PATH:
          if (info.method === "POST") return handleToken(request, options, now, refreshTtlMs);
          return undefined;
        case AUTHORIZE_PATH:
          if (info.method === "GET") return handleAuthorize(request, options, now);
          return undefined;
        default:
          return undefined;
      }
    },

    describeConsent(pendingId) {
      const row = findPending(pendingId);
      return {
        clientId: row.clientId,
        clientName: row.clientName,
        scope: [...row.scope],
        resource: row.resource,
      };
    },

    async approveConsent(pendingId, userId) {
      const row = findPending(pendingId);
      if (row.userId !== userId) throw new OAuthError("access_denied", "consent user mismatch");
      upsertConsent(stores, {
        userId: row.userId,
        clientId: row.clientId,
        clientName: row.clientName,
        resource: row.resource,
        scope: row.scope,
        now: now(),
      });
      const raw = await mintAuthorizationCode(stores, {
        userId: row.userId,
        clientId: row.clientId,
        redirectUri: row.redirectUri,
        resource: row.resource,
        scope: row.scope,
        codeChallenge: row.codeChallenge,
        jkt: null,
        now: now(),
      });
      stores.pending.delete(pendingId);
      return {
        redirectTo: appendQuery(row.redirectUri, {
          code: raw,
          iss: options.issuer.replace(/\/$/, ""),
          ...(row.state !== undefined ? { state: row.state } : {}),
        }),
      };
    },

    denyConsent(pendingId, userId) {
      const row = findPending(pendingId);
      if (row.userId !== userId) throw new OAuthError("access_denied", "consent user mismatch");
      stores.pending.delete(pendingId);
      return {
        redirectTo: appendQuery(row.redirectUri, {
          error: "access_denied",
          error_description: "resource owner denied the request",
          ...(row.state !== undefined ? { state: row.state } : {}),
        }),
      };
    },
  };
}

/** Consent-screen payload. */
export interface ConsentDescription {
  readonly clientId: string;
  readonly clientName: string | null;
  readonly scope: readonly string[];
  readonly resource: string;
}

/** Backwards-compatible alias for the edge handler alone. */
export const createOauthAsEdge = (
  options: OauthAsOptions,
): ((
  request: Request,
  info: { readonly method: string; readonly path: string },
) => Promise<Response | undefined>) => createOauthAs(options).edge;

/* ------------------------------------------------------------------ */
/* Authorize                                                           */
/* ------------------------------------------------------------------ */

async function handleAuthorize(
  request: Request,
  options: OauthAsOptions,
  now: () => number,
): Promise<Response> {
  const url = new URL(request.url);
  const failRedirect = (redirectUri: string, code: string, description: string, state?: string) =>
    Response.redirect(
      appendQuery(redirectUri, {
        error: code,
        error_description: description,
        ...(state !== undefined ? { state } : {}),
      }),
      302,
    );

  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const scopeRaw = url.searchParams.get("scope");
  const state = url.searchParams.get("state") ?? undefined;
  const resource = url.searchParams.get("resource");
  const challenge = url.searchParams.get("code_challenge");
  const challengeMethod = url.searchParams.get("code_challenge_method");

  let client: ClientCacheRow;
  try {
    if (clientId === null) {
      throw new OAuthError("invalid_request", "missing client_id");
    }
    client = await resolveCimdClient(options.stores.clientCache, clientId, now(), options.fetchDoc);
  } catch (err) {
    return Response.json(oauthErrorBody(err), { status: statusOf(err) });
  }
  if (redirectUri === null || !client.metadata.redirect_uris.includes(redirectUri)) {
    return Response.json(
      oauthErrorBody(new OAuthError("invalid_request", "redirect_uri not registered")),
      { status: 400 },
    );
  }

  // Narrow to non-null for the rest of the handler.
  const resolvedClientId: string = clientId;

  if (responseType !== "code") {
    return failRedirect(
      redirectUri,
      "unsupported_response_type",
      "response_type must be code",
      state,
    );
  }
  if (challenge === null || challengeMethod !== "S256") {
    return failRedirect(redirectUri, "invalid_request", "PKCE S256 is required", state);
  }
  // RFC 8707 MUST — every authorization request carries resource, matching
  // the canonical URI exactly (no prefix games).
  if (resource !== options.resource) {
    return failRedirect(
      redirectUri,
      "invalid_target",
      `resource must be ${options.resource}`,
      state,
    );
  }

  const requestedScopes = scopeRaw !== null ? scopeRaw.split(" ").filter(Boolean) : [];

  // The human must already have a gate.auth user-plane session.
  const userId = await resolveUserId(request, options);
  if (userId === undefined) {
    const loginUrl = new URL(AUTHORIZE_PATH, url.origin);
    loginUrl.search = url.search;
    return Response.redirect(
      `${url.origin}/auth/sign-in?next=${encodeURIComponent(loginUrl.pathname + loginUrl.search)}`,
      302,
    );
  }

  const existing = findConsent(options.stores.consents, userId, resolvedClientId, options.resource);
  const covered =
    existing !== undefined &&
    existing.revokedAt === null &&
    requestedScopes.every((s) => existing.scope.includes(s));

  if (!covered) {
    // Hand the decision to the app's own consent screen: park the fully
    // validated context server-side; the screen only ever sees a pending id.
    const pendingId = cryptoId();
    options.stores.pending.set(pendingId, {
      id: pendingId,
      userId,
      clientId: resolvedClientId,
      clientName: client.metadata.client_name ?? null,
      redirectUri,
      resource: options.resource,
      scope: requestedScopes,
      codeChallenge: challenge,
      state,
      expiresAt: now() + OAUTH_CODE_TTL_MS * 10,
    });
    const target = options.consentPath ?? "/oauth/consent";
    return Response.redirect(
      appendQuery(target.startsWith("/") ? `${url.origin}${target}` : target, {
        consent: pendingId,
      }),
      302,
    );
  }

  const code = await mintAuthorizationCode(options.stores, {
    userId,
    clientId: resolvedClientId,
    redirectUri,
    resource: options.resource,
    scope: requestedScopes.length > 0 ? requestedScopes : (existing?.scope ?? []),
    codeChallenge: challenge,
    jkt: null,
    now: now(),
  });
  return Response.redirect(
    appendQuery(redirectUri, {
      code,
      iss: options.issuer.replace(/\/$/, ""),
      ...(state !== undefined ? { state } : {}),
    }),
    302,
  );
}

/* ------------------------------------------------------------------ */
/* Token                                                               */
/* ------------------------------------------------------------------ */

type FormParams = URLSearchParams;

async function handleToken(
  request: Request,
  options: OauthAsOptions,
  now: () => number,
  refreshTtlMs: number,
): Promise<Response> {
  let form: FormParams;
  try {
    const raw = await request.text();
    form = new URLSearchParams(raw);
  } catch {
    return jsonError(new OAuthError("invalid_request", "form-encoded body required"));
  }
  const grantType = form.get("grant_type");
  try {
    if (grantType === "authorization_code") {
      return jsonOk(await tokenByCode(request, form, options, now, refreshTtlMs));
    }
    if (grantType === "refresh_token") {
      return jsonOk(await tokenByRefresh(request, form, options, now, refreshTtlMs));
    }
    throw new OAuthError("unsupported_grant_type", "only authorization_code and refresh_token");
  } catch (err) {
    return jsonError(err);
  }
}

function tokenEndpointUrl(options: OauthAsOptions, _incoming: Request): string {
  return `${options.issuer.replace(/\/$/, "")}/oauth/token`;
}

async function tokenByCode(
  request: Request,
  form: FormParams,
  options: OauthAsOptions,
  now: () => number,
  refreshTtlMs: number,
): Promise<TokenResponse> {
  const t = now();
  const code = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const verifier = form.get("code_verifier");
  const resource = form.get("resource");
  if (!code || !clientId || !redirectUri || !verifier || !resource) {
    throw new OAuthError(
      "invalid_request",
      "code, client_id, redirect_uri, code_verifier, resource are required",
    );
  }
  if (resource !== options.resource) {
    throw new OAuthError("invalid_target", `resource must be ${options.resource}`);
  }

  const codeHash = await hashSecret(code);
  const row = [...options.stores.authCodes.values()].find((r) => r.codeHash === codeHash);
  if (!row) throw new OAuthError("invalid_grant", "unknown authorization code");
  if (row.consumedAt !== null) throw new OAuthError("invalid_grant", "authorization code replayed");
  if (row.expiresAt <= t) throw new OAuthError("invalid_grant", "authorization code expired");
  if (row.clientId !== clientId) throw new OAuthError("invalid_grant", "client mismatch");
  if (row.redirectUri !== redirectUri)
    throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  if (row.resource !== resource) throw new OAuthError("invalid_target", "resource mismatch");

  const expectedChallenge = await pkceS256(verifier);
  if (expectedChallenge !== row.codeChallenge) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  // DPoP is mandatory (locked decision 2) — the proof binds the token to
  // this client's key via cnf.jkt from here forward.
  const proof = request.headers.get("dpop");
  if (!proof) throw new OAuthError("invalid_request", "DPoP proof required");
  const htu = tokenEndpointUrl(options, request);
  const jwk = await verifyDpopProof(proof, { htm: "POST", htu, now: t, accessToken: undefined });
  const jkt = await jwkThumbprint(jwk);
  if (row.jkt !== null && row.jkt !== jkt) {
    throw new OAuthError("invalid_grant", "DPoP key mismatch for this authorization");
  }

  row.consumedAt = t;

  return issueTokenPair(options, {
    userId: row.userId,
    clientId: row.clientId,
    resource: row.resource,
    scope: row.scope,
    jkt,
    now: t,
    refreshTtlMs,
  });
}

async function tokenByRefresh(
  request: Request,
  form: FormParams,
  options: OauthAsOptions,
  now: () => number,
  refreshTtlMs: number,
): Promise<TokenResponse> {
  const t = now();
  const raw = form.get("refresh_token");
  const clientId = form.get("client_id");
  const resource = form.get("resource");
  if (!raw || !clientId || !resource) {
    throw new OAuthError("invalid_request", "refresh_token, client_id, resource are required");
  }
  if (resource !== options.resource) {
    throw new OAuthError("invalid_target", `resource must be ${options.resource}`);
  }
  const hash = await hashSecret(raw);
  const row = [...options.stores.refreshTokens.values()].find((r) => r.hash === hash);
  if (!row) throw new OAuthError("invalid_grant", "unknown refresh token");

  // Rotation with family reuse detection (same model as oke_refresh_tokens).
  if (row.usedAt !== null || row.revokedAt !== null) {
    revokeRefreshFamily(options.stores.refreshTokens, row.familyId, t);
    revokeUserClientAccessTokens(options.stores.accessTokens, row.userId, row.clientId, t);
    throw new OAuthError("invalid_grant", "refresh token reuse detected; family revoked");
  }
  if (row.expiresAt <= t) throw new OAuthError("invalid_grant", "refresh token expired");
  if (row.clientId !== clientId) throw new OAuthError("invalid_grant", "client mismatch");
  if (row.resource !== resource) throw new OAuthError("invalid_target", "resource mismatch");

  const proof = request.headers.get("dpop");
  if (!proof) throw new OAuthError("invalid_request", "DPoP proof required");
  const htu = tokenEndpointUrl(options, request);
  const jwk = await verifyDpopProof(proof, { htm: "POST", htu, now: t });
  const jkt = await jwkThumbprint(jwk);
  if (row.jkt !== jkt) {
    throw new OAuthError("invalid_grant", "DPoP key mismatch for this grant");
  }

  // Rotate: burn this row, issue a fresh pair bound to the same key and
  // the SAME family so reuse detection can revoke everything downstream.
  row.usedAt = t;
  row.revokedAt = t;

  return issueTokenPair(options, {
    userId: row.userId,
    clientId: row.clientId,
    resource: row.resource,
    scope: row.scope,
    jkt,
    now: t,
    refreshTtlMs,
    familyId: row.familyId,
  });
}

/* ------------------------------------------------------------------ */
/* Shared issuance                                                     */
/* ------------------------------------------------------------------ */

/** Token endpoint success payload (RFC 6749 §5.1 + DPoP fields). */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "DPoP";
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly scope: string;
}

async function issueTokenPair(
  options: OauthAsOptions,
  input: {
    userId: string;
    clientId: string;
    resource: string;
    scope: readonly string[];
    jkt: string;
    now: number;
    refreshTtlMs: number;
    /** Continue an existing refresh family (rotation keeps the same id). */
    familyId?: string;
  },
): Promise<TokenResponse> {
  const jti = cryptoId();
  const expiresInSec = Math.floor(OAUTH_ACCESS_TTL_MS / 1000);
  const claims: OAuthAccessClaims = {
    iss: options.issuer.replace(/\/$/, ""),
    sub: input.userId,
    client_id: input.clientId,
    aud: input.resource,
    scope: input.scope.join(" "),
    iat: Math.floor(input.now / 1000),
    exp: Math.floor(input.now / 1000) + expiresInSec,
    jti,
    cnf: { jkt: input.jkt },
  };
  const accessToken = await signAccessToken(options.stores.keys, claims);

  options.stores.accessTokens.set(jti, {
    id: jti,
    userId: input.userId,
    clientId: input.clientId,
    resource: input.resource,
    scope: input.scope,
    jkt: input.jkt,
    expiresAt: input.now + OAUTH_ACCESS_TTL_MS,
    revokedAt: null,
    createdAt: input.now,
  });

  const refreshRaw = `ort_${cryptoId()}`;
  const familyId = input.familyId ?? cryptoId();
  // Keyed by row id — a family keeps multiple generations side by side so
  // reuse detection can find (and revoke) every one of them.
  const rowId = cryptoId();
  options.stores.refreshTokens.set(rowId, {
    id: rowId,
    familyId,
    userId: input.userId,
    clientId: input.clientId,
    resource: input.resource,
    scope: input.scope,
    jkt: input.jkt,
    hash: await hashSecret(refreshRaw),
    expiresAt: input.now + input.refreshTtlMs,
    usedAt: null,
    revokedAt: null,
  });

  return {
    access_token: accessToken,
    token_type: "DPoP",
    expires_in: expiresInSec,
    refresh_token: refreshRaw,
    scope: input.scope.join(" "),
  };
}

/**
 * Mint a single-use authorization code (authorize redirect path and the
 * consent-approve Flow both land here).
 *
 * @param stores - Store bundle
 * @param input - Grant context captured at authorize time
 */
export async function mintAuthorizationCode(
  stores: AsStoreBundle,
  input: {
    userId: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    scope: readonly string[];
    codeChallenge: string;
    jkt: string | null;
    now: number;
  },
): Promise<string> {
  const raw = `oac_${cryptoId()}`;
  const id = cryptoId();
  stores.authCodes.set(id, {
    id,
    codeHash: await hashSecret(raw),
    userId: input.userId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scope: input.scope,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    jkt: input.jkt,
    expiresAt: input.now + OAUTH_CODE_TTL_MS,
    consumedAt: null,
    createdAt: input.now,
  });
  pruneExpired(stores.authCodes, input.now);
  return raw;
}

/**
 * Approve consent for `(user, client)` covering the requested scopes
 * (called by the app's consent-approve Flow after the user clicks allow).
 *
 * @param stores - Store bundle
 * @param input - Consent context
 */
export function upsertConsent(
  stores: AsStoreBundle,
  input: {
    userId: string;
    clientId: string;
    clientName: string | null;
    resource: string;
    scope: readonly string[];
    now: number;
  },
): void {
  const key = consentKey(input.userId, input.clientId);
  const existing = stores.consents.get(key);
  if (existing && existing.revokedAt === null) {
    const merged = [...new Set([...existing.scope, ...input.scope])];
    stores.consents.set(key, { ...existing, scope: merged, updatedAt: input.now });
    return;
  }
  stores.consents.set(key, {
    userId: input.userId,
    clientId: input.clientId,
    clientName: input.clientName,
    resource: input.resource,
    scope: [...input.scope],
    grantedAt: existing?.grantedAt ?? input.now,
    updatedAt: input.now,
    revokedAt: null,
  });
}

function findConsent(
  consents: Map<string, ConsentRow>,
  userId: string,
  clientId: string,
  _resource: string,
): ConsentRow | undefined {
  return consents.get(consentKey(userId, clientId));
}

function consentKey(userId: string, clientId: string): string {
  return `${userId}:${clientId}`;
}

function revokeRefreshFamily(
  refreshes: Map<string, AsRefreshTokenRow>,
  familyId: string,
  at: number,
): void {
  for (const row of refreshes.values()) {
    if (row.familyId === familyId && row.revokedAt === null) row.revokedAt = at;
  }
}

function revokeUserClientAccessTokens(
  tokens: Map<string, AccessTokenRow>,
  userId: string,
  clientId: string,
  at: number,
): void {
  for (const row of tokens.values()) {
    if (row.userId === userId && row.clientId === clientId && row.revokedAt === null) {
      row.revokedAt = at;
    }
  }
}

function pruneExpired(codes: Map<string, AuthCodeRow>, now: number): void {
  for (const [id, row] of codes) {
    if (row.expiresAt <= now || row.consumedAt !== null) codes.delete(id);
  }
}

async function resolveUserId(
  request: Request,
  options: OauthAsOptions,
): Promise<string | undefined> {
  const resolver = options.userFromRequest;
  if (!resolver) return undefined;
  try {
    return await resolver(request);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */

function oauthErrorBody(err: unknown): { error: string; error_description?: string } {
  if (err instanceof OAuthError) {
    return {
      error: err.code,
      ...(err.description ? { error_description: err.description } : {}),
    };
  }
  return { error: "server_error" };
}

function statusOf(err: unknown): number {
  if (err instanceof OAuthError) return err.status;
  return 500;
}

function jsonOk(body: TokenResponse): Response {
  return Response.json(body, {
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

function jsonError(err: unknown): Response {
  return Response.json(oauthErrorBody(err), {
    status: statusOf(err),
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

function appendQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Re-exported for tests / consent flows.
export { createDpopSigner, decodeDpopProof, OAuthError };
export { createAsStores, cryptoId, hashSecret } from "./stores.ts";
