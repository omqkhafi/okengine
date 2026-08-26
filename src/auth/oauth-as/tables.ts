/**
 * Authorization Server table names — `oke_oauth_` prefix, kept off
 * `AUTH_TABLES` so Store-only / non-MCP graphs never pin the AS schema.
 *
 * Same opt-in discipline as tenant tables (`oke_tenants`). MCP is the
 * Resource Server *surface*; OAuth is the persistence domain, hence the
 * secondary prefix is `oauth_`, never `mcp_`.
 */

/** Opt-in via the `mcpOauth` plugin. */
export const OAUTH_AS_TABLES = {
  /** ES256 signing keys — public JWK inline, private material sealed. */
  signingKeys: "oke_oauth_signing_keys",
  /** CIMD metadata cache — cache, not a DCR registry (locked decision 1). */
  clientCache: "oke_oauth_client_cache",
  /** Single-use authorization codes (SHA-256 hashed at rest). */
  authCodes: "oke_oauth_auth_codes",
  /** Issued access tokens — `resource` (RFC 8707) + `cnf.jkt` (RFC 9449). */
  accessTokens: "oke_oauth_access_tokens",
  /** Rotating refresh tokens — same binding fields as access tokens. */
  refreshTokens: "oke_oauth_refresh_tokens",
  /** Per-(user, client) consent grants — audit source for Console. */
  consents: "oke_oauth_consents",
} as const;

/** Metadata document fetched from a CIMD `client_id` URL (draft-ietf-oauth-client-id-metadata-document). */
export interface CimdClientMetadata {
  /** Must equal the CIMD URL exactly. */
  readonly client_id: string;
  readonly client_name?: string;
  /** Exact registered redirect URIs — never derived from a request. */
  readonly redirect_uris: readonly string[];
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly token_endpoint_auth_method?: string;
  /** Space-separated scope vocabulary the client may request. */
  readonly scope?: string;
  readonly jwks_uri?: string;
  readonly jwks?: unknown;
}

/** Cached CIMD snapshot. */
export interface ClientCacheRow {
  readonly clientId: string;
  readonly metadata: CimdClientMetadata;
  readonly fetchedAt: number;
  deniedAt: number | null;
}

/** One ES256 signing key. Lifecycle fields mutate in place (rotation). */
export interface SigningKeyRow {
  readonly kid: string;
  readonly alg: "ES256";
  readonly publicJwk: Record<string, string>;
  readonly privateKey: CryptoKey;
  active: boolean;
  readonly createdAt: number;
  rotatedAt: number | null;
}

/** One authorization code row — the code itself is never stored. */
export interface AuthCodeRow {
  readonly id: string;
  /** SHA-256 hex of the raw code. */
  readonly codeHash: string;
  readonly userId: string;
  readonly clientId: string;
  /** Exact redirect URI captured at authorize time. */
  readonly redirectUri: string;
  /** Canonical RFC 8707 resource URI. */
  readonly resource: string;
  readonly scope: readonly string[];
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  /** DPoP JWK thumbprint bound at authorize time (null = no proof yet). */
  readonly jkt: string | null;
  readonly expiresAt: number;
  consumedAt: number | null;
  readonly createdAt: number;
}

/** One issued access token row, keyed by `jti`. */
export interface AccessTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
  readonly resource: string;
  readonly scope: readonly string[];
  readonly jkt: string | null;
  readonly expiresAt: number;
  revokedAt: number | null;
  readonly createdAt: number;
}

/** One rotating refresh-token row (family model mirrors `oke_refresh_tokens`). */
export interface AsRefreshTokenRow {
  readonly id: string;
  readonly familyId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly resource: string;
  readonly scope: readonly string[];
  readonly jkt: string | null;
  /** SHA-256 hex of the raw token. */
  readonly hash: string;
  readonly expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}

/**
 * Per-(user, client) consent — who consented to what, when.
 * Scope merges on re-approval; revocation is in place.
 */
export interface ConsentRow {
  readonly userId: string;
  readonly clientId: string;
  clientName: string | null;
  readonly resource: string;
  /** Cumulative granted scopes across approvals until revoked. */
  scope: readonly string[];
  readonly grantedAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

/**
 * A validated authorize request parked for the app consent screen.
 * Created only after full validation; consumed once by approve/deny.
 */
export interface PendingAuthorizeRow {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scope: readonly string[];
  readonly codeChallenge: string;
  readonly state: string | undefined;
  readonly expiresAt: number;
}
