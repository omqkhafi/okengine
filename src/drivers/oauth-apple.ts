/**
 * `apple` OIDC driver — `response_mode=form_post` web flow, ES256
 * client-secret JWT minted per exchange from the team private key, and the
 * strict string/boolean `email_verified` parse (Apple sends `"false"` as a
 * string — naive truthiness would mark unverified emails verified).
 */

import {
  type OAuthAssertion,
  type OAuthAssertionInput,
  type OAuthAuthorizeInput,
  type OAuthAuthorizeResult,
  type OAuthDriver,
  type OAuthExchangeInput,
  type OAuthExchangeResult,
} from "./oauth-types.ts";
import { buildAuthorizeQuery, normalizeEmail, parseEmailVerified } from "./oauth-shared.ts";
import { createAppleClientSecretJwt, discoverOpenId, verifyIdToken } from "./oauth-oidc.ts";

const AUTHORIZATION_SERVER_ID = "https://appleid.apple.com";

/** Default Apple scopes. */
export const APPLE_DEFAULT_SCOPES = ["name", "email"] as const;

/** Apple-specific driver options. */
export interface AppleDriverOptions {
  /** Apple Developer `teamId` (`iss` of the client-secret JWT). */
  readonly teamId?: string;
  /** Sign in with Apple private-key id (`kid`). */
  readonly keyId?: string;
  /** PKCS#8 PEM private key (Vault-resolved). */
  readonly privateKeyPem?: string;
  readonly scopes?: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Open the Apple driver.
 *
 * @param options - Team/key material and injectable fetch
 */
export function openOAuthApple(options: AppleDriverOptions = {}): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "apple",
    kind: "oidc",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return {
        url: buildAuthorizeQuery(`${AUTHORIZATION_SERVER_ID}/auth/authorize`, input, {
          response_mode: "form_post",
        }),
      };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      if (
        input.clientSecretJwt === undefined &&
        (!options.teamId || !options.keyId || !options.privateKeyPem)
      ) {
        throw new Error(
          "apple: clientSecretJwt override or teamId + keyId + privateKeyPem required",
        );
      }
      const endpoints = await discoverOpenId(AUTHORIZATION_SERVER_ID, fetchFn);
      return exchangeAppleForm(endpoints.tokenEndpoint, input);
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      if (!input.tokens.idToken) {
        throw new Error("apple: token response missing id_token");
      }
      const claims = await verifyIdToken({
        idToken: input.tokens.idToken,
        jwksUri: `${AUTHORIZATION_SERVER_ID}/auth/keys`,
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
        name: appleName(input),
        raw: claims.payload,
      };
    },
  };

  async function exchangeAppleForm(
    tokenEndpoint: string,
    exchange: OAuthExchangeInput,
  ): Promise<OAuthExchangeResult> {
    let clientSecret: string;
    if (exchange.clientSecretJwt !== undefined) {
      clientSecret = await exchange.clientSecretJwt();
    } else {
      clientSecret = await createAppleClientSecretJwt({
        privateKeyPem: options.privateKeyPem!,
        teamId: options.teamId!,
        keyId: options.keyId!,
        clientId: exchange.clientId,
      });
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: exchange.code,
      redirect_uri: exchange.redirectUri,
      client_id: exchange.clientId,
      client_secret: clientSecret,
    });
    const res = await fetchFn(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json["access_token"] !== "string") {
      throw new Error(`apple: token endpoint HTTP ${res.status}`);
    }
    const expiresIn = json["expires_in"];
    return {
      tokens: {
        accessToken: json["access_token"],
        ...(typeof json["refresh_token"] === "string"
          ? { refreshToken: json["refresh_token"] as string }
          : {}),
        ...(typeof expiresIn === "number"
          ? { expiresAt: Math.floor(Date.now() / 1000 + expiresIn * 1000) }
          : {}),
        raw: json,
      },
    };
  }
}

/**
 * Apple delivers the user's name only on first authorization via a
 * form-posted `user` JSON field; drivers receive it through the raw token bag.
 *
 * @param input - Assertion inputs
 */
function appleName(input: OAuthAssertionInput): string | undefined {
  const userField = input.tokens.raw["user"];
  if (typeof userField !== "string") return undefined;
  try {
    const parsed = JSON.parse(userField) as { name?: Record<string, string> };
    const n = parsed.name;
    if (!n) return undefined;
    return [n.givenName, n.familyName].filter(Boolean).join(" ") || undefined;
  } catch {
    return undefined;
  }
}
