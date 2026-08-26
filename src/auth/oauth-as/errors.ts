/**
 * OAuth protocol errors — every AS failure maps to a registered `error`
 * code with the correct HTTP status (RFC 6749 / RFC 6750 / RFC 8707).
 *
 * Scope misses carry the specific missing scope name(s), matching this
 * project's capability-token discipline without touching OKE1007
 * (which stays reserved for undeclared `effects.calls`).
 */

/** Registered OAuth error codes emitted by the AS. */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "invalid_token"
  | "insufficient_scope"
  | "access_denied"
  | "server_error";

/** Default HTTP status per OAuth error code. */
export const OAUTH_ERROR_STATUS: Readonly<Record<OAuthErrorCode, number>> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  invalid_target: 400,
  invalid_token: 401,
  insufficient_scope: 403,
  access_denied: 400,
  server_error: 500,
};

/**
 * OAuth protocol error — thrown by AS internals, rendered as JSON by the
 * token endpoint (body) or WWW-Authenticate (RS challenges).
 */
export class OAuthError extends Error {
  /** Registered error code. */
  readonly code: OAuthErrorCode;
  /** Human-readable description safe to return to clients. */
  readonly description: string;
  /** Missing scope names when `code === "insufficient_scope"` / `"invalid_scope"`. */
  readonly missingScopes: readonly string[];

  /**
   * @param code - Registered error code
   * @param description - Safe diagnostic
   * @param missingScopes - Specific missing scope names (when applicable)
   */
  constructor(code: OAuthErrorCode, description: string, missingScopes: readonly string[] = []) {
    super(`oauth ${code}${description ? `: ${description}` : ""}`);
    this.name = "OAuthError";
    this.code = code;
    this.description = description;
    this.missingScopes = missingScopes;
  }

  /** HTTP status for this error. */
  get status(): number {
    return OAUTH_ERROR_STATUS[this.code];
  }
}
