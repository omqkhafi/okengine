/**
 * `discord` OAuth2 driver — `GET /users/@me`. Trust: `verified === true`
 * (requires the `email` scope). `email` may legitimately be null
 * (phone-number accounts) — sign-in proceeds without an email.
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

const AUTHORIZATION_SERVER_ID = "https://discord.com";

/** Default Discord scopes. */
export const DISCORD_DEFAULT_SCOPES = ["identify", "email"] as const;

/**
 * Open the Discord driver.
 *
 * @param options - Optional scope override / injectable fetch
 */
export function openOAuthDiscord(
  options: { readonly scopes?: readonly string[]; readonly fetch?: typeof globalThis.fetch } = {},
): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "discord",
    kind: "oauth2",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      return {
        url: buildAuthorizeQuery("https://discord.com/oauth2/authorize", input, { prompt: "consent" }),
      };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      return {
        tokens: await postTokenRequest({ tokenEndpoint: "https://discord.com/api/oauth2/token", input }),
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      return resolveOauth2Assertion(input, async (accessToken) => {
        const me = await fetchProviderJson(
          "https://discord.com/api/users/@me",
          accessToken,
          fetchFn,
          "discord",
        );
        const subject = typeof me["id"] === "string" ? me["id"] : undefined;
        if (subject === undefined) throw new Error("discord: profile missing id");
        return {
          providerId: "discord",
          subject,
          // Null email is valid — normalizeEmail(undefined) → absent.
          ...(me["email"] !== null && me["email"] !== undefined ? { email: me["email"] } : {}),
          ...(me["verified"] !== undefined ? { verified: me["verified"] } : {}),
          ...(typeof me["global_name"] === "string" && me["global_name"].length > 0
            ? { name: me["global_name"] }
            : typeof me["username"] === "string"
              ? { name: me["username"] }
              : {}),
          raw: me,
        };
      });
    },
  };
}
