/**
 * `microsoft` OIDC driver — Entra ID v2.0 endpoints, `tenant` selector
 * (default `common`: personal MSA + work/school).
 *
 * Issuer nuance: discovery under `common` / `organizations` / `consumers`
 * advertises `https://login.microsoftonline.com/{tenantid}/v2.0`, so the flow
 * record stores that template as `expectedIssuer` and the callback validates
 * the concrete token `iss` against the per-tenant regex with a matching
 * GUID-shaped `tid` claim.
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
import { buildAuthorizeQuery, normalizeEmail, parseEmailVerified } from "./oauth-shared.ts";
import { discoverOpenId, verifyIdToken } from "./oauth-oidc.ts";

const LOGIN_ORIGIN = "https://login.microsoftonline.com";
const TENANT_TEMPLATE_ISSUER = `${LOGIN_ORIGIN}/{tenantid}/v2.0`;
const CONCRETE_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([0-9a-fA-F-]{36})\/v2\.0$/;

/** Microsoft tenant selector or concrete tenant id. */
export type MicrosoftTenant = "common" | "organizations" | "consumers" | string;

/**
 * Open the Microsoft driver.
 *
 * @param options - Tenant selector + injectable fetch
 */
export function openOAuthMicrosoft(
  options: {
    readonly tenant?: MicrosoftTenant;
    readonly scopes?: readonly string[];
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): OAuthDriver {
  const tenant = options.tenant ?? "common";
  const discoveryIssuer = `${LOGIN_ORIGIN}/${tenant}/v2.0`;
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "microsoft",
    kind: "oidc",
    // Flow records store the {tenantid} template — never the discovery URL.
    authorizationServerId: TENANT_TEMPLATE_ISSUER,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return {
        url: buildAuthorizeQuery(`${discoveryIssuer}/authorize`, input, {
          response_mode: "query",
        }),
      };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      if (!input.clientSecret) {
        throw new OAuthProtocolError("missing_secret", "microsoft requires a client secret");
      }
      const endpoints = await discoverOpenId(discoveryIssuer, fetchFn);
      const res = await fetchFn(endpoints.tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code_verifier: input.codeVerifier,
        }).toString(),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || typeof body["access_token"] !== "string") {
        throw new OAuthProtocolError(
          "exchange_failed",
          `Token endpoint returned HTTP ${res.status}: ${String(body["error"] ?? "unknown")}`,
        );
      }
      const expiresIn = body["expires_in"];
      return {
        tokens: {
          accessToken: body["access_token"],
          ...(typeof body["refresh_token"] === "string"
            ? { refreshToken: body["refresh_token"] as string }
            : {}),
          ...(typeof expiresIn === "number"
            ? { expiresAt: Math.floor(Date.now() / 1000 + expiresIn * 1000) }
            : {}),
          ...(typeof body["scope"] === "string" ? { scopes: [body["scope"] as string] } : {}),
          ...(typeof body["id_token"] === "string" ? { idToken: body["id_token"] as string } : {}),
          raw: body,
        },
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      if (!input.tokens.idToken) {
        throw new OAuthProtocolError(
          "missing_id_token",
          "microsoft token response missing id_token",
        );
      }
      const claims = await verifyMicrosoftIdToken({
        idToken: input.tokens.idToken,
        expectedAudience: input.expectedAudience,
        ...(input.expectedNonce !== undefined ? { expectedNonce: input.expectedNonce } : {}),
        fetchFn,
        ...(input.now !== undefined ? { now: input.now } : {}),
      });
      const email =
        normalizeEmail(claims.payload["email"]) ??
        normalizeEmail(claims.payload["preferred_username"]);
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

/**
 * Verify a Microsoft ID token: standard OIDC checks against the concrete
 * per-tenant issuer (`…/{tid}/v2.0`) plus `tid` shape validation — the
 * `{tenantid}` discovery template is never accepted as a literal issuer.
 *
 * @param options - Token + expectations + injectable fetch/clock
 */
async function verifyMicrosoftIdToken(options: {
  readonly idToken: string;
  readonly expectedAudience: string;
  readonly expectedNonce?: string;
  readonly fetchFn: typeof globalThis.fetch;
  readonly now?: () => number;
}): Promise<{ payload: Record<string, unknown>; subject: string; issuer: string }> {
  const parsed = await import("./oauth-shared.ts").then((m) => m.parseJwt(options.idToken));
  const iss = parsed.payload["iss"];
  if (typeof iss !== "string") {
    throw new OAuthProtocolError("issuer_mismatch", "ID token missing iss");
  }
  const match = CONCRETE_ISSUER_RE.exec(iss);
  if (!match) {
    throw new OAuthProtocolError(
      "issuer_mismatch",
      `ID token iss ${iss} is not a concrete login.microsoftonline.com tenant issuer`,
    );
  }
  const tid = parsed.payload["tid"];
  if (typeof tid !== "string" || !/^[0-9a-fA-F-]{36}$/.test(tid)) {
    throw new OAuthProtocolError("tenant_mismatch", "ID token tid is not a GUID");
  }

  const claims = await verifyIdToken({
    idToken: options.idToken,
    jwksUri: `${iss}/discovery/v2.0/keys`,
    expectedIssuer: iss,
    expectedAudience: options.expectedAudience,
    ...(options.expectedNonce !== undefined ? { expectedNonce: options.expectedNonce } : {}),
    fetchFn: options.fetchFn,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return claims;
}
