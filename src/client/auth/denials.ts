/**
 * Auth / gate denial narrowers — envelope values, not throws.
 *
 * @module
 */

/** Common auth Flow error codes (server `fail` codes). */
export const AUTH_ERROR_CODES = {
  AuthFailed: "AuthFailed",
  AuthRateLimited: "AuthRateLimited",
  Unauthorized: "Unauthorized",
  Forbidden: "Forbidden",
} as const;

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  if (!("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorReason(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return undefined;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

/** True when the envelope error is `Unauthorized`. */
export function isUnauthorized(error: unknown): boolean {
  return errorCode(error) === AUTH_ERROR_CODES.Unauthorized;
}

/** True when the envelope error is `Forbidden` (policy / CSRF / etc.). */
export function isForbidden(error: unknown): boolean {
  return errorCode(error) === AUTH_ERROR_CODES.Forbidden;
}

/** True when the envelope error is `AuthRateLimited` or HTTP `RateLimited`. */
export function isAuthRateLimited(error: unknown): boolean {
  const code = errorCode(error);
  return code === AUTH_ERROR_CODES.AuthRateLimited || code === "RateLimited";
}

/** True when Forbidden reason is CSRF. */
export function isCsrf(error: unknown): boolean {
  return isForbidden(error) && errorReason(error) === "csrf";
}

/**
 * Best-effort scopes named in a Forbidden envelope (`gate` / `reason` / `missing`).
 * UI hint only — Gate on Flows remains the security boundary.
 *
 * @param error - Envelope error
 */
export function forbiddenScopes(error: unknown): readonly string[] {
  if (!isForbidden(error)) return [];
  if (error === null || typeof error !== "object") return [];
  const data = (error as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return [];
  const bag = data as Record<string, unknown>;
  if (Array.isArray(bag.missing)) {
    return bag.missing.filter((s): s is string => typeof s === "string");
  }
  if (typeof bag.gate === "string" && bag.gate.includes(":")) return [bag.gate];
  if (typeof bag.reason === "string" && bag.reason.includes(":")) return [bag.reason];
  return [];
}

/** True when sign-in data asks for a second factor. */
export function isTwoFactorRequired(data: unknown): data is {
  readonly twoFactorRequired: true;
  readonly challengeId: string;
  readonly method: string;
  readonly userId: string;
} {
  return (
    data !== null &&
    typeof data === "object" &&
    (data as { twoFactorRequired?: unknown }).twoFactorRequired === true &&
    typeof (data as { challengeId?: unknown }).challengeId === "string"
  );
}

/** True when data looks like issued session tokens. */
export function isSessionTokens(data: unknown): data is {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt?: number;
  readonly userId?: string;
} {
  return (
    data !== null &&
    typeof data === "object" &&
    typeof (data as { accessToken?: unknown }).accessToken === "string" &&
    typeof (data as { refreshToken?: unknown }).refreshToken === "string"
  );
}
