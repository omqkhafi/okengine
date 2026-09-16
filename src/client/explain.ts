/**
 * Collapse unknown flow / transport errors into a small UX kind.
 *
 * Import from `okengine/client/explain` (kept off the 5 kB `okengine/client`
 * edge graph). Prefer {@link match} on the envelope. Name a code when this
 * screen has special recovery (`FlightFull` → waitlist). Kind arms handle
 * chrome (`auth` → sign-in). {@link matchError} / {@link match} require `_`
 * so that dump bucket is never optional.
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

const ERROR_KINDS: readonly ErrorKind[] = [
  "auth",
  "permission",
  "missing",
  "conflict",
  "invalid",
  "limited",
  "unavailable",
  "failed",
];

const KIND_SET: ReadonlySet<string> = new Set(ERROR_KINDS);

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

/**
 * Envelope `{ data, error }` accepted by {@link match}.
 *
 * @typeParam O - Success data
 * @typeParam Err - Failure (flow error or transport)
 */
export type MatchableResult<O, Err extends ExplainableError = ExplainableError> =
  | { readonly data: O; readonly error: null }
  | { readonly data: null; readonly error: Err };

/**
 * Cases for {@link matchError}: named codes, optional UX kinds, required `_`.
 *
 * Code arms receive typed `data`. Kind arms and `_` receive {@link ExplainedError}.
 * Dispatch order: named code → kind → `_`. Kind names (`auth`, `failed`, …) are
 * reserved — they are never treated as domain codes.
 *
 * @typeParam Err - Envelope error
 * @typeParam R - Handler return
 */
export type MatchErrorCases<Err extends ExplainableError, R> = {
  [K in Exclude<Err["code"], ErrorKind | "_">]?: (
    data: Extract<Err, { readonly code: K }> extends { readonly data: infer D } ? D : unknown,
  ) => R;
} & {
  [K in ErrorKind]?: (explained: ExplainedError & { readonly kind: K }) => R;
} & {
  /** Required dump bucket — unknown / unhandled codes and kinds. */
  readonly _: (explained: ExplainedError) => R;
};

/**
 * Cases for {@link match}: required `ok` plus {@link MatchErrorCases}.
 *
 * @typeParam O - Success data
 * @typeParam Err - Envelope error
 * @typeParam R - Handler return
 */
export type MatchResultCases<O, Err extends ExplainableError, R> = {
  readonly ok: (data: O) => R;
} & MatchErrorCases<Err, R>;

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
 * @param error - Envelope `error` from a {@link MatchableResult}
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

/**
 * Run a named code handler, a UX {@link ErrorKind} arm, or `_`.
 *
 * `_` is required so store auto-map, transport, and domain codes always have
 * a path. Named arms narrow `data` (e.g. `FlightFull` → `seatsLeft`). Kind
 * arms receive {@link ExplainedError} (`auth` → sign-in, `invalid` → fields).
 *
 * @param error - Envelope error
 * @param cases - Optional per-code / per-kind handlers plus required `_`
 */
export function matchError<Err extends ExplainableError, R>(
  error: Err,
  cases: MatchErrorCases<Err, R>,
): R {
  const code = error.code;
  const codeFn = lookupCode<R>(cases, code);
  if (codeFn !== undefined) return codeFn(error.data);
  const explained = explain(error);
  const kindFn = lookupKind<R>(cases, explained.kind);
  if (kindFn !== undefined) return kindFn(explained);
  return cases._(explained);
}

/**
 * Run `ok` on success, otherwise the same arms as {@link matchError}.
 *
 * One import, one call — no `isOk` then `matchError` split.
 *
 * @param result - Envelope `{ data, error }`
 * @param cases - Required `ok`, optional per-code / per-kind, required `_`
 */
export function match<T extends MatchableResult<unknown, ExplainableError>, R>(
  result: T,
  cases: MatchResultCases<MatchData<T>, MatchErr<T>, R>,
): R {
  if (result.error === null) return cases.ok(result.data as MatchData<T>);
  return matchError(result.error as MatchErr<T>, cases);
}

/** Success `data` from a {@link MatchableResult} union (null-error branch only). */
type MatchData<T> = T extends { readonly error: null; readonly data: infer O } ? O : never;

/** Failure from a {@link MatchableResult} union (`error` excluding `null`). */
type MatchErr<T> = T extends { readonly error: infer E }
  ? E extends null
    ? never
    : E extends ExplainableError
      ? E
      : never
  : never;

function lookupCode<R>(cases: object, code: string): ((data: unknown) => R) | undefined {
  if (code === "_" || code === "ok" || KIND_SET.has(code)) return undefined;
  const handler = (cases as Record<string, unknown>)[code];
  return typeof handler === "function" ? (handler as (data: unknown) => R) : undefined;
}

function lookupKind<R>(
  cases: object,
  kind: ErrorKind,
): ((explained: ExplainedError) => R) | undefined {
  const handler = (cases as Record<string, unknown>)[kind];
  return typeof handler === "function" ? (handler as (explained: ExplainedError) => R) : undefined;
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
