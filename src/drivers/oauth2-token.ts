/**
 * Shared token-exchange helper for OAuth 2.0-only drivers.
 * (Split from oauth2-common to keep profile logic separate from transport.)
 */

import { OAuthProtocolError, type OAuthTokenSet } from "./oauth-types.ts";
import type { OAuthExchangeInput } from "./oauth-types.ts";

/**
 * POST `code` (+ PKCE verifier) to a provider token endpoint and normalize
 * the response. Providers without client auth (PKCE public clients) omit the
 * secret automatically when undefined.
 *
 * @param options - Endpoint + exchange inputs
 */
export async function postTokenRequest(options: {
  readonly tokenEndpoint: string;
  readonly input: OAuthExchangeInput;
}): Promise<OAuthTokenSet> {
  const { input } = options;
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret !== undefined) params.set("client_secret", input.clientSecret);
  const fetchFn = input.fetch ?? globalThis.fetch;
  const res = await fetchFn(options.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      // X rejects JSON bodies; GitHub accepts both but form is universal.
      "user-agent": "okengine-oauth",
    },
    body: params.toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body["access_token"] !== "string") {
    throw new OAuthProtocolError(
      "exchange_failed",
      `${options.tokenEndpoint} returned HTTP ${res.status}: ${String(body["error"] ?? "unknown")}`,
    );
  }
  const expiresIn = body["expires_in"];
  return {
    accessToken: body["access_token"],
    ...(typeof body["refresh_token"] === "string"
      ? { refreshToken: body["refresh_token"] as string }
      : {}),
    ...(typeof expiresIn === "number"
      ? { expiresAt: Math.floor(Date.now() / 1000 + expiresIn * 1000) }
      : {}),
    ...(typeof body["scope"] === "string"
      ? { scopes: (body["scope"] as string).split(/\s+/).filter((s) => s.length > 0) }
      : {}),
    raw: body,
  };
}
