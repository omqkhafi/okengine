/**
 * Shared OAuth 2.0-only driver machinery: the "OIDC wrapper" — userinfo-
 * equivalent fetches normalized into an {@link OAuthAssertion}.
 *
 * These providers have no `iss` on their identity surface; the mix-up anchor
 * is the flow record's `authorizationServerId`, checked by the plugin before
 * any driver call (RFC 9700 §4.4 alternate: distinct callback paths).
 */

import type { OAuthAssertion, OAuthAssertionInput } from "./oauth-types.ts";
import { normalizeEmail } from "./oauth-shared.ts";

/**
 * Provider-agnostic profile fields a driver resolves before normalization.
 * `verified` carries only explicit provider attestations (GitHub primary,
 * Discord); Facebook / X / Figma omit it entirely → always unverified.
 */
export interface OAuth2Profile {
  readonly providerId: string;
  readonly subject: string;
  readonly email?: unknown;
  readonly verified?: unknown;
  readonly name?: unknown;
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * Fetch a provider JSON endpoint with bearer auth.
 *
 * @param url - Endpoint
 * @param accessToken - Bearer token
 * @param fetchFn - Injectable fetch
 * @param provider - Driver id for error context
 */
export async function fetchProviderJson(
  url: string,
  accessToken: string,
  fetchFn: typeof globalThis.fetch,
  provider: string,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      // GitHub v3 convention — avoids XML fallbacks.
      "user-agent": "okengine-oauth",
    },
  });
  if (!res.ok) {
    throw new Error(`${provider}: profile request failed with HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Trust matrix: verified only on an explicit boolean/string `true`. */
function trustVerified(verified: unknown): boolean {
  if (typeof verified === "boolean") return verified;
  if (typeof verified === "string") return verified === "true";
  return false;
}

/**
 * Build an {@link OAuthAssertion} from resolved provider fields.
 *
 * @param options - Profile fields plus the pinned issuer
 */
export function oauth2Assertion(
  options: OAuth2Profile & { readonly issuer: string },
): OAuthAssertion {
  const email = normalizeEmail(options.email);
  const name =
    typeof options.name === "string" && options.name.length > 0 ? options.name : undefined;
  return {
    subject: options.subject,
    issuer: options.issuer,
    ...(email !== undefined ? { email } : {}),
    emailVerified: trustVerified(options.verified),
    ...(name !== undefined ? { name } : {}),
    raw: { ...options.raw, provider: options.providerId },
  };
}

/**
 * Standard resolveAssertion shape for OAuth2 drivers.
 *
 * @param input - Assertion inputs
 * @param resolve - Profile resolver receiving the access token
 */
export async function resolveOauth2Assertion(
  input: OAuthAssertionInput,
  resolve: (accessToken: string) => Promise<OAuth2Profile>,
): Promise<OAuthAssertion> {
  const profile = await resolve(input.tokens.accessToken);
  return oauth2Assertion({ ...profile, issuer: input.expectedIssuer });
}
