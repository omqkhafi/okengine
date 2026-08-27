/**
 * `figma` OAuth2 driver — `GET /v1/me`. No verification field exists in the
 * API, so `emailVerified` is always false (locked decision 5). Token endpoint
 * requires HTTP Basic client auth.
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
import { buildAuthorizeQuery } from "./oauth-shared.ts";
import { fetchProviderJson, resolveOauth2Assertion } from "./oauth2-common.ts";

const AUTHORIZATION_SERVER_ID = "https://www.figma.com";

/** Default Figma scopes. */
export const FIGMA_DEFAULT_SCOPES = ["file_read"] as const;

function basicAuth(clientId: string, clientSecret: string): string {
  const raw = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

/**
 * Open the Figma driver.
 *
 * @param options - Optional scope override / injectable fetch
 */
export function openOAuthFigma(
  options: { readonly scopes?: readonly string[]; readonly fetch?: typeof globalThis.fetch } = {},
): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "figma",
    kind: "oauth2",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return { url: buildAuthorizeQuery("https://www.figma.com/oauth", input) };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      if (!input.clientSecret) {
        throw new OAuthProtocolError("missing_secret", "figma requires a client secret");
      }
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        code_verifier: input.codeVerifier,
      });
      const res = await fetchFn("https://api.figma.com/v1/oauth/token", {
        method: "POST",
        headers: {
          authorization: basicAuth(input.clientId, input.clientSecret),
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: params.toString(),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || typeof body["access_token"] !== "string") {
        throw new OAuthProtocolError(
          "exchange_failed",
          `figma token endpoint returned HTTP ${res.status}: ${String(body["err"] ?? body["error"] ?? "unknown")}`,
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
          raw: body,
        },
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      return resolveOauth2Assertion(input, async (accessToken) => {
        const me = await fetchProviderJson(
          "https://api.figma.com/v1/me",
          accessToken,
          fetchFn,
          "figma",
        );
        const subject =
          typeof me["id"] === "string"
            ? me["id"]
            : typeof me["handle"] === "string"
              ? me["handle"]
              : undefined;
        if (subject === undefined) throw new Error("figma: profile missing id");
        return {
          providerId: "figma",
          subject,
          ...(me["email"] !== undefined && me["email"] !== null ? { email: me["email"] } : {}),
          // API exposes no verification field — always unverified.
          ...(typeof me["handle"] === "string" ? { name: me["handle"] } : {}),
          raw: me,
        };
      });
    },
  };
}
