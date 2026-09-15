/**
 * Collapse unknown flow / transport errors into a small UX kind.
 *
 * Import from `okengine/client/explain` (kept off the 5 kB `okengine/client`
 * edge graph). Switch on `error.code` when this screen has special recovery
 * (`FlightFull` → waitlist). Use {@link explain} for chrome when the code is
 * unknown. {@link matchError} requires `_` so that dump bucket is never optional.
 */

/** UX family for toasts, sign-in, forms — not an HTTP status. */
export type ErrorKind =
  | "auth"
  | "permission"
  | "missing"
  | "conflict"
  | "invalid"
  | "limited"
  | "unavailable"
  | "failed";

/** Display-ready failure from {@link explain}. */
export interface ExplainedError {
  readonly kind: ErrorKind;
  readonly code: string;
  /** Envelope message, transport message, or `code` — never empty. */
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  /** `ValidationError` path → message (`.`-joined; empty path is `_`). */
  readonly fields?: Record<string, string>;
}

/** Input accepted by {@link explain} (flow error or transport). */
export type ExplainableError = {
  readonly code: string;
  readonly data?: unknown;
  readonly message?: string;
};

const KIND: Record<string, ErrorKind> = {
  Unauthorized: "auth",
  AuthFailed: "auth",
  Forbidden: "permission",
  NotFound: "missing",
  Conflict: "conflict",
  ForeignKey: "conflict",
  ValidationError: "invalid",
  InvalidQuery: "invalid",
  UnsupportedMediaType: "invalid",
  RateLimited: "limited",
  AuthRateLimited: "limited",
  ServiceUnavailable: "unavailable",
  InternalError: "failed",
};

const INVALID_DB = new Set(["not_null", "check", "invalid", "too_long", "out_of_range"]);

/**
 * Collapse a flow or transport error into chrome (`kind`, `message`, `fields`).
 *
 * Domain codes (`OutOfStock`, `FlightFull`) are `failed` — product UX stays
 * on `error.code`. Does not throw.
 *
 * @param error - Envelope `error` from a {@link ClientResult}
 */
export function explain(error: ExplainableError): ExplainedError {
  const kind = kindOf(error);
  const retryable = kind === "unavailable" || kind === "limited";
  const retryAfterMs = retryable ? retryDelay(error.data) : undefined;
  const fields = error.code === "ValidationError" ? fieldsOf(error.data) : undefined;
  return {
    kind,
    code: error.code,
    message: messageOf(error),
    retryable,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(fields !== undefined ? { fields } : {}),
  };
}

type MatchErrorCases<Err extends ExplainableError, R> = {
  [K in Err["code"]]?: (
    data: Extract<Err, { readonly code: K }> extends { readonly data: infer D } ? D : unknown,
  ) => R;
} & {
  /** Required dump bucket — unknown / unhandled codes. */
  readonly _: (explained: ExplainedError) => R;
};

/**
 * Run a named code handler, or `_` with {@link explain} for everything else.
 *
 * `_` is required so store auto-map, transport, and domain codes always have
 * a path. Named arms narrow `data` (e.g. `FlightFull` → `seatsLeft`).
 *
 * @param error - Envelope error
 * @param cases - Optional per-code handlers plus required `_`
 */
export function matchError<Err extends ExplainableError, R>(
  error: Err,
  cases: MatchErrorCases<Err, R>,
): R {
  const code = error.code;
  if (code !== "_") {
    const handler = (cases as Record<string, ((data: unknown) => R) | undefined>)[code];
    if (typeof handler === "function") {
      return handler(error.data);
    }
  }
  return cases._(explain(error));
}

function kindOf(error: ExplainableError): ErrorKind {
  if (error.code === "TransportError") {
    return transportStatus(error.data) === 404 ? "missing" : "unavailable";
  }
  if (error.code === "DatabaseError") {
    const reason = dataReason(error.data);
    if (reason === "retryable") return "unavailable";
    if (reason !== undefined && INVALID_DB.has(reason)) return "invalid";
    return "failed";
  }
  return KIND[error.code] ?? "failed";
}

function messageOf(error: ExplainableError): string {
  if (typeof error.message === "string" && error.message.length > 0) return error.message;
  const data = error.data;
  if (
    error.code === "TransportError" &&
    data !== null &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string" &&
    (data as { message: string }).message.length > 0
  ) {
    return (data as { message: string }).message;
  }
  return error.code;
}

function retryDelay(data: unknown): number | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const rec = data as { retryAfterMs?: unknown; retryAfter?: unknown };
  if (typeof rec.retryAfterMs === "number") return rec.retryAfterMs;
  if (typeof rec.retryAfter === "number") return rec.retryAfter * 1000;
  return undefined;
}

function fieldsOf(data: unknown): Record<string, string> | undefined {
  if (data === null || typeof data !== "object" || !("issues" in data)) return undefined;
  const issues = (data as { issues: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    if (issue === null || typeof issue !== "object") continue;
    const rec = issue as { message?: unknown; path?: unknown };
    if (typeof rec.message !== "string") continue;
    fields[pathKey(rec.path)] = rec.message;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function pathKey(path: unknown): string {
  if (!Array.isArray(path) || path.length === 0) return "_";
  const parts: string[] = [];
  for (const p of path) {
    if (typeof p === "string" || typeof p === "number") parts.push(String(p));
  }
  return parts.length > 0 ? parts.join(".") : "_";
}

function transportStatus(data: unknown): number | undefined {
  if (data === null || typeof data !== "object" || !("status" in data)) return undefined;
  const status = (data as { status: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function dataReason(data: unknown): string | undefined {
  if (data === null || typeof data !== "object" || !("reason" in data)) return undefined;
  const reason = (data as { reason: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}
