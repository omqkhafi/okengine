/**
 * `google` OIDC driver — Authorization Code + PKCE against
 * `https://accounts.google.com`. Mix-up anchor: ID token
 * `iss=https://accounts.google.com` (RFC 9207 also honored via the same
 * equality check when Google includes it).
 */

import {
  OAuthProtocolError,
  type OAuthAssertion,
  type OAuthAssertionInput,
  type OAuthAuthorizeInput,
  type OAuthAuthorizeResult,
  type OAuthDriver,
  type OAuthExchangeInput,
  type OAuthExchangeResult,
} from "./oauth-types.ts";
import {
  buildAuthorizeQuery,
  formPost,
  normalizeEmail,
  parseEmailVerified,
} from "./oauth-shared.ts";
import { discoverOpenId, verifyIdToken } from "./oauth-oidc.ts";

const AUTHORIZATION_SERVER_ID = "https://accounts.google.com";

/**
 * Open the Google driver.
 *
 * @param options - Optional scope override / injectable fetch
 */
export function openOAuthGoogle(
  options: { readonly scopes?: readonly string[]; readonly fetch?: typeof globalThis.fetch } = {},
): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "google",
    kind: "oidc",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return {
        url: buildAuthorizeQuery(
          `${AUTHORIZATION_SERVER_ID}/o/oauth2/v2/auth`,
          input,
          // Always (re)select accounts — never an untargeted session.
          { prompt: "select_account" },
        ),
      };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      if (!input.clientSecret) {
        throw new OAuthProtocolError("missing_secret", "google requires a client secret");
      }
      const endpoints = await discoverOpenId(AUTHORIZATION_SERVER_ID, fetchFn);
      return exchangeForm(endpoints.tokenEndpoint, input);
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      if (!input.tokens.idToken) {
        throw new OAuthProtocolError("missing_id_token", "google token response missing id_token");
      }
      const claims = await verifyIdToken({
        idToken: input.tokens.idToken,
        jwksUri: `${AUTHORIZATION_SERVER_ID}/oauth2/v3/certs`,
        expectedIssuer: input.expectedIssuer,
        expectedAudience: input.expectedAudience,
        ...(input.expectedNonce !== undefined ? { expectedNonce: input.expectedNonce } : {}),
        fetchFn,
        ...(input.now !== undefined ? { now: input.now } : {}),
      });
      const email = normalizeEmail(claims.payload["email"]);
      return {
        subject: claims.subject,
        issuer: claims.issuer,
        ...(email !== undefined ? { email } : {}),
        emailVerified: parseEmailVerified(claims.payload["email_verified"]),
        ...(typeof claims.payload["name"] === "string"
          ? { name: claims.payload["name"] as string }
          : {}),
        raw: claims.payload,
      };
    },
  };
}

/** Shared form POST for OIDC token exchanges (Google). */
export async function exchangeForm(
  tokenEndpoint: string,
  input: OAuthExchangeInput,
): Promise<OAuthExchangeResult> {
  const clientSecret =
    input.clientSecretJwt !== undefined ? await input.clientSecretJwt() : input.clientSecret;
  if (!clientSecret) {
    throw new OAuthProtocolError("missing_secret", "token exchange requires a client secret");
  }
  const fetchFn = input.fetch ?? globalThis.fetch;
  const res = await fetchFn(
    tokenEndpoint,
    formPost({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: clientSecret,
      code_verifier: input.codeVerifier,
    }),
  );
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body["access_token"] !== "string") {
    throw new OAuthProtocolError(
      "exchange_failed",
      `Token endpoint returned HTTP ${res.status}: ${String(body["error"] ?? "unknown")}`,
    );
  }
  return { tokens: tokensFromResponse(body) };
}

/** Normalize a provider token response into an {@link OAuthTokenSet}-shape. */
export function tokensFromResponse(body: Record<string, unknown>) {
  const expiresIn = body["expires_in"];
  const nowSec = Date.now() / 1000;
  return {
    accessToken: requireAccessToken(body),
    ...(typeof body["refresh_token"] === "string"
      ? { refreshToken: body["refresh_token"] as string }
      : {}),
    ...(typeof expiresIn === "number" ? { expiresAt: Math.floor(nowSec + expiresIn * 1000) } : {}),
    ...(typeof body["scope"] === "string"
      ? { scopes: (body["scope"] as string).split(/\s+/).filter((s) => s.length > 0) }
      : {}),
    ...(typeof body["id_token"] === "string" ? { idToken: body["id_token"] as string } : {}),
    raw: body,
  };
}

function requireAccessToken(body: Record<string, unknown>): string {
  const token = body["access_token"];
  if (typeof token !== "string" || token.length === 0) {
    throw new OAuthProtocolError("exchange_failed", "Token response missing access_token");
  }
  return token;
}
