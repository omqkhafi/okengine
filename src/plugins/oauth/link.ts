/**
 * Identity bridge — every successful OAuth callback routes through
 * `linkOrProvision`; driver assertions never write identities directly.
 * `IdentityError` codes map onto the typed `AuthFailed` error surface.
 */

import { IdentityError, linkOrProvision, type IdentityStore } from "../../auth/identity.ts";
import type { OAuthAssertion } from "../../drivers/oauth-types.ts";
import type { OAuthProviderId } from "./shared.ts";

/**
 * Credential provider string namespacing OAuth accounts
 * (`oke_credentials.provider = "oauth:google"` etc.).
 *
 * @param provider - Plugin provider id
 */
export function oauthCredentialProvider(provider: OAuthProviderId): string {
  return `oauth:${provider}`;
}

/** Outcome of the identity bridge. */
export interface OauthLinkResult {
  readonly userId: string;
}

/**
 * Route a verified assertion through `linkOrProvision`.
 *
 * GHSA-6g38-8j4p-j3pr defense: `emailVerified` comes verbatim from the
 * driver trust matrix (default false), and `linkOrProvision` refuses to take
 * over an existing email (`email_in_use`) unless `currentUserId` proves the
 * caller already owns the account.
 *
 * @param identities - Shared identity store
 * @param provider - Provider id
 * @param assertion - Verified driver assertion
 * @param currentUserId - Authenticated subject when linking from a session
 */
export async function oauthLink(
  identities: IdentityStore,
  provider: OAuthProviderId,
  assertion: OAuthAssertion,
  currentUserId?: string,
): Promise<OauthLinkResult> {
  const { user } = await linkOrProvision(identities, {
    provider: oauthCredentialProvider(provider),
    providerAccountId: assertion.subject,
    ...(assertion.email !== undefined ? { email: assertion.email } : {}),
    emailVerified: assertion.emailVerified,
    ...(assertion.name !== undefined ? { name: assertion.name } : {}),
    ...(currentUserId !== undefined ? { currentUserId } : {}),
  });
  return { userId: user.id };
}

/**
 * Map an {@link IdentityError} code onto a client-safe failure reason.
 *
 * @param err - Identity error
 */
export function identityFailureReason(err: unknown): string | undefined {
  if (err instanceof IdentityError) {
    // Enumeration hygiene: never disclose which emails exist.
    if (err.code === "email_in_use" || err.code === "email_conflict") return "email_in_use";
    if (err.code === "identity_not_found") return "invalid_credentials";
    return err.code;
  }
  return undefined;
}
