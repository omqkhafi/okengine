/**
 * `facebook` OAuth2 driver — Graph API `GET /me?fields=id,name,email`.
 *
 * Trust: `emailVerified` is **always false** — Facebook provides no
 * verification signal to apps (locked decision 5). Email may be null for
 * phone-only accounts.
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

const AUTHORIZATION_SERVER_ID = "https://www.facebook.com";
const GRAPH_VERSION = "v21.0";

/** Default Facebook scopes. */
export const FACEBOOK_DEFAULT_SCOPES = ["email", "public_profile"] as const;

/**
 * Open the Facebook driver.
 *
 * @param options - Optional Graph version / scope override / injectable fetch
 */
export function openOAuthFacebook(
  options: {
    readonly graphVersion?: string;
    readonly scopes?: readonly string[];
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): OAuthDriver {
  const version = options.graphVersion ?? GRAPH_VERSION;
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "facebook",
    kind: "oauth2",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return {
        url: buildAuthorizeQuery(`https://www.facebook.com/${version}/dialog/oauth`, input),
      };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      return {
        tokens: await postTokenRequest({
          tokenEndpoint: `https://graph.facebook.com/${version}/oauth/access_token`,
          input,
        }),
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      return resolveOauth2Assertion(input, async (accessToken) => {
        const me = await fetchProviderJson(
          `https://graph.facebook.com/${version}/me?fields=id,name,email`,
          accessToken,
          fetchFn,
          "facebook",
        );
        const subject = typeof me["id"] === "string" ? me["id"] : undefined;
        if (subject === undefined) throw new Error("facebook: profile missing id");
        return {
          providerId: "facebook",
          subject,
          ...(me["email"] !== undefined && me["email"] !== null ? { email: me["email"] } : {}),
          // No trustworthy provider signal — always unverified.
          ...(typeof me["name"] === "string" ? { name: me["name"] } : {}),
          raw: me,
        };
      });
    },
  };
}
