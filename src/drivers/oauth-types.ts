/**
 * Protocol-named OAuth client driver contracts.
 *
 * Two provider shapes (locked design):
 * - `oidc` — discovery + JWKS-verified ID tokens (Google, Apple, Microsoft)
 * - `oauth2` — code → access token → userinfo-equivalent, normalized into the
 *   same {@link OAuthAssertion} ("OIDC wrapper" pattern; GitHub, Discord, X,
 *   Facebook, Figma)
 *
 * Every driver enforces Authorization Code + PKCE (S256). Implicit and ROPC
 * grants are never implemented.
 */

/** Supported social providers. */
export type OAuthDriverId =
  | "apple"
  | "discord"
  | "facebook"
  | "figma"
  | "github"
  | "google"
  | "microsoft"
  | "x";

/** Token payload returned by a provider's token endpoint. */
export interface OAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch-ms expiry of the access token when the provider reports one. */
  readonly expiresAt?: number;
  readonly scopes?: readonly string[];
  /** Raw OIDC ID token (base64url JWT) — `oidc` drivers only. */
  readonly idToken?: string;
  /** Full provider response (secrets included) — never logged. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** Input to {@link OAuthDriver.buildAuthorizeUrl}. */
export interface OAuthAuthorizeInput {
  readonly clientId: string;
  /**
   * EXACT redirect URI string registered at the provider. Never derived from
   * the incoming request — RFC 9700 requires byte-exact comparison.
   */
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
  /** Base64url(SHA-256(code_verifier)) — PKCE S256, mandatory. */
  readonly codeChallenge: string;
  /** OIDC nonce echoed in the ID token. */
  readonly nonce?: string;
}

/** Result of {@link OAuthDriver.buildAuthorizeUrl}. */
export interface OAuthAuthorizeResult {
  /** Provider authorization endpoint URL incl. all query parameters. */
  readonly url: string;
}

/** Input to {@link OAuthDriver.exchangeCode}. */
export interface OAuthExchangeInput {
  readonly clientId: string;
  /** Confidential-client secret (revealed from Vault at the boundary). */
  readonly clientSecret?: string;
  /**
   * Apple only — signs a fresh ES256 client-secret JWT per exchange.
   * Wins over {@link clientSecret} when set.
   */
  readonly clientSecretJwt?: () => Promise<string>;
  /** Exact redirect URI stored on the flow record at start. */
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
  /** Injectable fetch (tests). Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock. */
  readonly now?: () => number;
}

/** Result of {@link OAuthDriver.exchangeCode}. */
export interface OAuthExchangeResult {
  readonly tokens: OAuthTokenSet;
}

/** Input to {@link OAuthDriver.resolveAssertion}. */
export interface OAuthAssertionInput {
  readonly tokens: OAuthTokenSet;
  /**
   * Issuer the flow was initiated against (stored on the flow record at
   * start). Assertions whose issuer differs are mix-up attacks — rejected.
   */
  readonly expectedIssuer: string;
  /** Expected ID token / client audience (= clientId). */
  readonly expectedAudience: string;
  /** Expected OIDC nonce from the flow record. */
  readonly expectedNonce?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

/**
 * Uniform internal identity assertion — the "OIDC wrapper" every driver
 * produces regardless of provider shape.
 *
 * `emailVerified` follows the per-provider trust matrix and defaults to
 * `false`; it is `true` only on an explicit provider attestation.
 */
export interface OAuthAssertion {
  /** Stable provider-scoped subject (`sub` / provider user id). */
  readonly subject: string;
  /** Verified issuer — equals {@link OAuthAssertionInput.expectedIssuer}. */
  readonly issuer: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly name?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * One social-login driver. Small, focused modules behind this shared
 * interface — never one generalized function branching on provider name.
 */
export interface OAuthDriver {
  readonly id: OAuthDriverId;
  /** `oidc` (discovery + ID token) or `oauth2` (userinfo equivalent). */
  readonly kind: "oidc" | "oauth2";
  /**
   * Stable issuer identifier bound to the flow record at start and checked
   * against the assertion on callback — the mix-up defense anchor
   * (RFC 9700 §4.4 / RFC 9207).
   */
  readonly authorizationServerId: string;
  /** Build the provider authorize URL (Authorization Code + PKCE S256). */
  buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult;
  /** Exchange `code` for tokens using the exact stored redirect URI. */
  exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult>;
  /**
   * Normalize tokens into an {@link OAuthAssertion}: OIDC drivers verify the
   * ID token (sig, iss, aud, nonce, exp); `oauth2` drivers call their
   * userinfo-equivalent endpoint.
   */
  resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion>;
}

/** Thrown on any OAuth protocol failure (exchange, assertion, mix-up). */
export class OAuthProtocolError extends Error {
  /** Machine-readable failure reason (safe to surface as `AuthFailed.reason`). */
  readonly reason: string;

  /**
   * @param reason - Stable failure slug (e.g. `issuer_mismatch`)
   * @param message - Human context (logged, never returned to clients)
   */
  constructor(reason: string, message: string) {
    super(message);
    this.name = "OAuthProtocolError";
    this.reason = reason;
  }
}
