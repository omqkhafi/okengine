/**
 * Built-in flow-boundary error codes — HTTP status + payload types.
 *
 * Always-on for `fx.fail` helpers and the typed client. Domain codes
 * (`OutOfStock`, `FlightFull`) stay on the exposure `errors:` bag.
 * No Zod — this module sits on the kernel edge graph.
 */

/** Built-in codes with a fixed HTTP status (not `DatabaseError`). */
export const BUILTIN_ERROR_STATUS = {
  ValidationError: 422,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  ForeignKey: 409,
  UnsupportedMediaType: 415,
  RateLimited: 429,
  AuthRateLimited: 429,
  InvalidQuery: 400,
  AuthFailed: 400,
  InternalError: 500,
  ServiceUnavailable: 503,
} as const;

/** Built-in error code (including `DatabaseError`). */
export type BuiltinErrorCode = keyof typeof BUILTIN_ERROR_STATUS | "DatabaseError";

/** `DatabaseError.data.reason` — encoder maps these to HTTP status. */
export type DatabaseErrorReason = "not_null" | "check" | "retryable" | "unknown";

/** Loose identity / constraint bag used by several built-in codes. */
export type BuiltinErrorBag = {
  readonly id?: string;
  readonly key?: string;
  readonly code?: string;
  readonly reason?: string;
  readonly gate?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly sqlstate?: string;
  readonly retryAfterMs?: number;
  readonly retryAfter?: number;
  readonly contentType?: string;
  readonly [key: string]: unknown;
};

/**
 * Built-in error code → payload. Client unions this with declared `errors:`.
 */
export type BuiltinErrorMap = {
  readonly ValidationError: { readonly issues: readonly unknown[] };
  readonly Unauthorized: BuiltinErrorBag;
  readonly Forbidden: BuiltinErrorBag;
  readonly NotFound: BuiltinErrorBag;
  readonly Conflict: BuiltinErrorBag;
  readonly ForeignKey: BuiltinErrorBag;
  readonly UnsupportedMediaType: BuiltinErrorBag;
  readonly RateLimited: { readonly retryAfterMs?: number };
  readonly AuthRateLimited: BuiltinErrorBag;
  readonly InvalidQuery: BuiltinErrorBag;
  readonly AuthFailed: BuiltinErrorBag;
  readonly DatabaseError: {
    readonly reason: DatabaseErrorReason;
    readonly sqlstate?: string;
    readonly constraint?: string;
    readonly table?: string;
    readonly column?: string;
  };
  readonly InternalError: Record<string, never>;
  readonly ServiceUnavailable: { readonly retryAfter?: number };
};

/**
 * HTTP status for a built-in failure code, or `undefined` for domain codes.
 *
 * `DatabaseError` uses `data.reason`: `not_null` / `check` → 422, `retryable`
 * → 503, anything else → 500.
 *
 * @param code - Failure `error.code`
 * @param data - Failure `error.data` (reason for `DatabaseError`)
 */
export function statusForBuiltinError(code: string, data?: unknown): number | undefined {
  if (code === "DatabaseError") {
    const reason = databaseErrorReason(data);
    if (reason === "not_null" || reason === "check") return 422;
    if (reason === "retryable") return 503;
    return 500;
  }
  if (Object.prototype.hasOwnProperty.call(BUILTIN_ERROR_STATUS, code)) {
    return BUILTIN_ERROR_STATUS[code as keyof typeof BUILTIN_ERROR_STATUS];
  }
  return undefined;
}

/**
 * HTTP status for a typed flow failure. Domain codes default to 400.
 *
 * @param code - Failure code
 * @param data - Failure payload
 */
export function httpStatusForFailure(code: string, data?: unknown): number {
  const mapped = statusForBuiltinError(code, data);
  if (mapped !== undefined) return mapped;
  return code.startsWith("OKE") ? 500 : 400;
}

function databaseErrorReason(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}
