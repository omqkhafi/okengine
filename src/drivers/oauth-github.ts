/**
 * `github` OAuth2 driver — `GET /user` plus **`GET /user/emails`** (the
 * `/user` `email` field is often null; the primary verified email requires
 * the `user:email` scope). Trust: `primary.verified === true`.
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

const AUTHORIZATION_SERVER_ID = "https://github.com";

/** Default GitHub scopes. */
export const GITHUB_DEFAULT_SCOPES = ["read:user", "user:email"] as const;

/**
 * Open the GitHub driver.
 *
 * @param options - Optional scope override / injectable fetch
 */
export function openOAuthGithub(
  options: { readonly scopes?: readonly string[]; readonly fetch?: typeof globalThis.fetch } = {},
): OAuthDriver {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    id: "github",
    kind: "oauth2",
    authorizationServerId: AUTHORIZATION_SERVER_ID,
    buildAuthorizeUrl(input: OAuthAuthorizeInput): OAuthAuthorizeResult {
      // GitHub PKCE is accepted and forwarded even though not OIDC.
      return { url: buildAuthorizeQuery("https://github.com/login/oauth/authorize", input) };
    },
    async exchangeCode(input: OAuthExchangeInput): Promise<OAuthExchangeResult> {
      return {
        tokens: await postTokenRequest({
          tokenEndpoint: "https://github.com/login/oauth/access_token",
          input,
        }),
      };
    },
    async resolveAssertion(input: OAuthAssertionInput): Promise<OAuthAssertion> {
      return resolveOauth2Assertion(input, async (accessToken) => {
        const user = await fetchProviderJson(
          "https://api.github.com/user",
          accessToken,
          fetchFn,
          "github",
        );
        const subject = typeof user["id"] === "number" ? String(user["id"]) : undefined;
        if (subject === undefined) throw new Error("github: profile missing numeric id");
        const login = typeof user["login"] === "string" ? user.login : undefined;
        const emails = await fetchProviderJson(
          "https://api.github.com/user/emails",
          accessToken,
          fetchFn,
          "github",
        ).catch(() => undefined);
        const list: readonly unknown[] = Array.isArray(emails) ? emails : [];
        const parsed = list.filter(isGitHubEmail);
        const primary = parsed.find((e) => e.primary === true) ?? parsed[0];
        return {
          providerId: "github",
          subject,
          ...(primary?.email !== undefined ? { email: primary.email } : {}),
          // Trust only an explicit verified flag on the selected entry.
          ...(primary !== undefined ? { verified: primary.verified } : {}),
          ...(login !== undefined ? { name: login } : {}),
          raw: user,
        };
      });
    },
  };
}

interface GitHubEmail {
  readonly email?: string;
  readonly primary?: boolean;
  readonly verified?: boolean;
}

function isGitHubEmail(value: unknown): value is GitHubEmail {
  return typeof value === "object" && value !== null;
}
