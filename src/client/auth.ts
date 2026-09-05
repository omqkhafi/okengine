/**
 * Optional auth helpers for {@link createClient} — not a second client factory.
 *
 * Prefer `createClient(url, { auth: { mode, … } })` so `api.auth` is attached.
 * {@link createAuthClient} remains the compose / bind escape hatch.
 *
 * @module
 */

export {
  AUTH_ERROR_CODES,
  forbiddenScopes,
  isAuthRateLimited,
  isCsrf,
  isForbidden,
  isSessionTokens,
  isTwoFactorRequired,
  isUnauthorized,
} from "./auth/denials.ts";
export {
  createAuthClient,
  type AuthApi,
  type AuthClient,
  type AuthMode,
  type AuthPersist,
  type AuthorizeQuery,
  type AuthorizeResult,
  type CreateAuthClientOptions,
  type SignInResult,
} from "./auth/create-auth-client.ts";
export {
  tokenFromRequestCookies,
  type CookieSource,
  type TokenFromCookiesOptions,
} from "./auth/cookies.ts";
export { createServerClient } from "./create-with-session.ts";
export {
  memorySession,
  persistSession,
  type MemorySession,
  type MemorySessionOptions,
  type SessionListener,
  type SessionTokens,
  type SessionUser,
} from "./auth/session.ts";
