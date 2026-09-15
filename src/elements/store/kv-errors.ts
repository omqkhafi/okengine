/**
 * Map Redis-wire KV errors to typed {@link FlowFailure} values.
 *
 * Lives on the store path — not the kernel edge graph. Availability and
 * retryable script/cluster replies become `ServiceUnavailable`. Programmer
 * mistakes (`WRONGTYPE`, `NOSCRIPT`) stay unmapped so the HTTP encoder
 * sanitizes them as `InternalError`.
 */

import { fail } from "../../kernel/fail-helpers.ts";
import type { FlowFailure } from "../../kernel/errors.ts";
import type { BuiltinErrorMap } from "../../kernel/builtin-errors.ts";

/** How to treat Redis `BUSY` / `TRYAGAIN` / `LOADING`. */
export type KvRetryableMode = "leave" | "unavailable";

/** Options for {@link kvErrorToFailure}. */
export interface KvErrorToFailureOptions {
  /**
   * `leave` — return `undefined` so {@link flow.retry} can rethrow.
   * `unavailable` — map to `ServiceUnavailable` after retries exhaust.
   */
  readonly retryable?: KvRetryableMode;
}

type KvFailure = FlowFailure<BuiltinErrorMap["ServiceUnavailable"]>;

type KvErrShape = {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
};

const RETRY_TOKEN = new Set(["BUSY", "BUSYKEY", "TRYAGAIN", "LOADING"]);
const UNAVAILABLE_TOKEN = new Set([
  "CLUSTERDOWN",
  "MASTERDOWN",
  "READONLY",
  "MISCONF",
  "OOM",
  "MOVED",
  "ASK",
  "UNBLOCKED",
]);
const CONN_CODE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

/**
 * True when `err` is a Redis `BUSY` / `TRYAGAIN` / `LOADING` reply.
 *
 * Left thrown during retries; mapped to `ServiceUnavailable` after exhaust.
 *
 * @param err - Caught driver error
 */
export function isRetryableKvError(err: unknown): boolean {
  return walk(err, (node) => retrySignal(node));
}

/**
 * Map a Redis-wire KV error to `ServiceUnavailable`, or `undefined` when it
 * is not an availability / retryable Redis failure.
 *
 * @param err - Caught value from `fx.store` KV ops
 * @param options - Retryable handling
 */
export function kvErrorToFailure(
  err: unknown,
  options: KvErrorToFailureOptions = {},
): KvFailure | undefined {
  const retryable = options.retryable ?? "leave";
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== "object") break;
    if (retrySignal(current)) {
      if (retryable === "leave") return undefined;
      return fail.serviceUnavailable();
    }
    if (isUnavailable(current)) return fail.serviceUnavailable();
    current = causeOf(current);
  }
  return undefined;
}

function retrySignal(err: unknown): boolean {
  return RETRY_TOKEN.has(redisToken(err));
}

function isUnavailable(err: unknown): boolean {
  const token = redisToken(err);
  if (UNAVAILABLE_TOKEN.has(token)) return true;
  if (CONN_CODE.has(token)) return true;
  if (/^ERR_REDIS_(CONNECTION|CONNECT|CLOSED|TIMEOUT|NETWORK)/.test(token)) return true;
  const message = errMessage(err);
  if (/max number of clients/i.test(message)) return true;
  if (/connection (closed|refused|reset|timed out)/i.test(message)) return true;
  if (/socket hang up|connect econn|read econn/i.test(message)) return true;
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE/i.test(message)) return true;
  return false;
}

function redisToken(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as KvErrShape;
  if (typeof e.code === "string" && e.code.length > 0) return e.code.toUpperCase();
  const message = typeof e.message === "string" ? e.message.trim() : "";
  const first = /^([A-Za-z][A-Za-z0-9_]+)/.exec(message)?.[1];
  return first ? first.toUpperCase() : "";
}

function errMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const message = (err as KvErrShape).message;
  return typeof message === "string" ? message : "";
}

function causeOf(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined;
  return (err as KvErrShape).cause;
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
