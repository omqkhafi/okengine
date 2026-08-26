/**
 * `x` OAuth2 driver (Authorization Code with PKCE — X has no OIDC).
 * Profile: `GET /2/users/me?user.fields=confirmed_email`.
 *
 * Trust: `emailVerified` is **always false** — `confirmed_email` is an app
 * permission gate, not a verification attestation (locked decision 5). Email
 * may be absent without the `users.email` scope + elevated app access.
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
import { buildAuthorizeQuery } from "./oauth-shared.ts";
import { fetchProviderJson, resolveOauth2Assertion } from "./oauth2-common.ts";
import { postTokenRequest } from "./oauth2-token.ts";

const AUTHORIZATION_SERVER_ID = "https://x.com";

/** Default X scopes. */
export const X_DEFAULT_SCOPES = ["users.read", "tweet.read"] as const;

/**
 * Open the X driver.
 *
 * @param options - Optional scope override / injectable fetch
 */
export function openOAuthX(
  options: { readonly scopes?: readonly string[]; readonly fetch?: typeof globalThis.fetch } = {},
): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "x",
    kind: "oauth2",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return { url: buildAuthorizeQuery("https://x.com/i/oauth2/authorize", input) };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      // X is a public client — no client_secret on the token call.
      return {
        tokens: await postTokenRequest({ tokenEndpoint: "https://api.x.com/2/oauth2/token", input }),
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      return resolveOauth2Assertion(input, async (accessToken) => {
        const res = await fetchProviderJson(
          "https://api.x.com/2/users/me?user.fields=id,name,username,confirmed_email",
          accessToken,
          fetchFn,
          "x",
        );
        const data = res["data"];
        if (data === null || typeof data !== "object") throw new Error("x: profile missing data");
        const user = data as Record<string, unknown>;
        const subject = typeof user["id"] === "string" ? user["id"] : undefined;
        if (subject === undefined) throw new Error("x: profile missing id");
        return {
          providerId: "x",
          subject,
          ...(user["confirmed_email"] !== undefined ? { email: user["confirmed_email"] } : {}),
          // Locked trust decision: never verified via X.
          name: typeof user["name"] === "string" ? user["name"] : undefined,
          raw: user,
        };
      });
    },
  };
}
