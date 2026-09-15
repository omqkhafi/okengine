/**
 * Map `fs` / `s3` files-driver errors to typed {@link FlowFailure} values.
 *
 * Lives on the store path — not the kernel edge graph. Availability and
 * throttle replies become `ServiceUnavailable`; access / path-escape become
 * `Forbidden`. Missing `get` (`null`) is not auto-`NotFound`.
 */

import { fail } from "../../kernel/fail-helpers.ts";
import type { FlowFailure } from "../../kernel/errors.ts";
import type { BuiltinErrorMap } from "../../kernel/builtin-errors.ts";

/** How to treat SlowDown / EBUSY / AWS `InternalError`. */
export type FilesRetryableMode = "leave" | "unavailable";

/** Options for {@link filesErrorToFailure}. */
export interface FilesErrorToFailureOptions {
  /**
   * `leave` — return `undefined` so {@link flow.retry} can rethrow.
   * `unavailable` — map to `ServiceUnavailable` after retries exhaust.
   */
  readonly retryable?: FilesRetryableMode;
}

type FilesFailure = FlowFailure<
  BuiltinErrorMap["Forbidden"] | BuiltinErrorMap["ServiceUnavailable"]
>;

type FilesErrShape = {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
};

const RETRY_TOKEN = new Set([
  "SLOWDOWN",
  "REQUESTTIMEOUT",
  "INTERNALERROR",
  "REDUCEYOURREQUESTRATE",
  "PRIORREQUESTNOTCOMPLETE",
  "OPERATIONABORTED",
  "EBUSY",
  "EAGAIN",
  "EWOULDBLOCK",
  "EIO",
]);
const UNAVAILABLE_TOKEN = new Set([
  "NOSUCHBUCKET",
  "SERVICEUNAVAILABLE",
  "ENOSPC",
  "EDQUOT",
  "EMFILE",
  "ENFILE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ECONNABORTED",
]);
const FORBIDDEN_TOKEN = new Set([
  "ACCESSDENIED",
  "ACCESSFORBIDDEN",
  "ALLACCESSDISABLED",
  "INVALIDACCESSKEYID",
  "SIGNATUREDOESNOTMATCH",
  "INVALIDSECURITY",
  "EXPIREDTOKEN",
  "TOKENREFRESHREQUIRED",
  "ACCOUNTPROBLEM",
  "EACCES",
  "EPERM",
  "EROFS",
]);

/**
 * True when `err` is a throttle / busy files failure.
 *
 * Left thrown during retries; mapped to `ServiceUnavailable` after exhaust.
 *
 * @param err - Caught driver error
 */
export function isRetryableFilesError(err: unknown): boolean {
  return walk(err, (node) => retrySignal(node));
}

/**
 * Map an `fs` / `s3` driver throw to `Forbidden` or `ServiceUnavailable`,
 * or `undefined` when it is not a known files failure.
 *
 * @param err - Caught value from `fx.store` files ops
 * @param options - Retryable handling
 */
export function filesErrorToFailure(
  err: unknown,
  options: FilesErrorToFailureOptions = {},
): FilesFailure | undefined {
  const retryable = options.retryable ?? "leave";
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== "object") break;
    if (isInvalidObjectKey(current)) return fail.forbidden({ reason: "invalid_key" });
    if (retrySignal(current)) {
      if (retryable === "leave") return undefined;
      return fail.serviceUnavailable();
    }
    if (isForbidden(current)) return fail.forbidden();
    if (isUnavailable(current)) return fail.serviceUnavailable();
    current = causeOf(current);
  }
  return undefined;
}

function retrySignal(err: unknown): boolean {
  if (RETRY_TOKEN.has(filesToken(err))) return true;
  return httpStatus(err) === 429;
}

function isForbidden(err: unknown): boolean {
  if (FORBIDDEN_TOKEN.has(filesToken(err))) return true;
  if (httpStatus(err) === 403) return true;
  const message = errMessage(err);
  return /access denied|not authorized to perform/i.test(message);
}

function isUnavailable(err: unknown): boolean {
  const token = filesToken(err);
  if (UNAVAILABLE_TOKEN.has(token)) return true;
  const status = httpStatus(err);
  if (status === 502 || status === 503 || status === 504) return true;
  const message = errMessage(err);
  if (/specified bucket does not exist|NoSuchBucket/i.test(message)) return true;
  if (/connection (closed|refused|reset|timed out)/i.test(message)) return true;
  if (/socket hang up|connect econn|read econn/i.test(message)) return true;
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOSPC|EMFILE/i.test(message)) return true;
  return false;
}

function isInvalidObjectKey(err: unknown): boolean {
  return /^Invalid object key:/i.test(errMessage(err));
}

function filesToken(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as FilesErrShape;
  if (typeof e.code === "string" && e.code.length > 0) {
    return e.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  const xml = /<Code>([A-Za-z][A-Za-z0-9]+)<\/Code>/i.exec(errMessage(err));
  if (xml?.[1]) return xml[1].toUpperCase();
  const message = errMessage(err).trim();
  const first = /^([A-Za-z][A-Za-z0-9_]+)/.exec(message)?.[1];
  return first ? first.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as FilesErrShape;
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  return undefined;
}

function errMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const message = (err as FilesErrShape).message;
  return typeof message === "string" ? message : "";
}

function causeOf(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined;
  return (err as FilesErrShape).cause;
}

function walk(err: unknown, pred: (node: unknown) => boolean): boolean {
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (pred(current)) return true;
    current = causeOf(current);
    if (current === undefined) break;
  }
  return false;
}
