/**
 * AI provider / transport error classification for recovery chains.
 *
 * Retryable failures may retry once on the same model, then advance `via`.
 * Permanent failures stop the chain immediately.
 */

import { parseDurationMs } from "../clock/duration.ts";
import type { AiTimeout } from "./declare.ts";

/** Optional structured fields drivers may attach to thrown errors. */
export interface AiErrorFields {
  readonly status?: number;
  readonly code?: string;
}

/**
 * Resolve a prompt/ask timeout to milliseconds.
 *
 * @param timeout - Duration string (`"30s"`) or ms number
 * @returns Milliseconds, or `undefined` when unset / invalid
 */
export function resolveTimeoutMs(timeout: AiTimeout | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (typeof timeout === "number") {
    return Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;
  }
  const ms = parseDurationMs(timeout);
  return ms > 0 ? ms : undefined;
}

/**
 * Merge an optional deadline into an ambient abort signal.
 *
 * @param timeoutMs - Deadline in ms
 * @param ambient - Existing signal (e.g. request cancel)
 */
export function mergeAskAbortSignal(
  timeoutMs: number | undefined,
  ambient?: AbortSignal,
): AbortSignal | undefined {
  if (timeoutMs === undefined) return ambient;
  const deadline = AbortSignal.timeout(timeoutMs);
  if (!ambient) return deadline;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([ambient, deadline]);
  }
  return deadline;
}

/**
 * HTTP / abort / network failures that may succeed on retry or another model.
 *
 * @param err - Thrown value from a model attempt
 */
export function isRetryableAiError(err: unknown): boolean {
  if (err == null) return false;

  const status = readStatus(err);
  if (status !== undefined) {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status >= 400 && status <= 499) return false;
  }

  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  const httpMatch = /\bHTTP\s*(\d{3})\b/i.exec(message);
  if (httpMatch?.[1]) {
    const code = Number(httpMatch[1]);
    if (code === 429 || (code >= 500 && code <= 599)) return true;
    if (code >= 400 && code <= 499) return false;
  }

  if (name === "AbortError" || name === "TimeoutError") return true;
  if (lower.includes("aborterror") || lower.includes("timeout")) return true;
  if (
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket hang up") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return true;
  }

  // Unclassified provider/transport errors — allow recovery to the next model.
  return err instanceof Error;
}

/**
 * Attach an HTTP status onto an Error for {@link isRetryableAiError}.
 *
 * @param message - Error message
 * @param status - HTTP status
 */
export function aiHttpError(message: string, status: number): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function readStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as AiErrorFields).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

/**
 * Whether a declared prompt `out` schema expects a `via` field
 * (JSON-schema properties or Zod `.shape`).
 *
 * @param schema - Prompt `out` declaration
 */
export function outExpectsVia(schema: unknown): boolean {
  if (schema == null || typeof schema !== "object") return false;
  if (
    "properties" in schema &&
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties) &&
    "via" in (schema.properties as Record<string, unknown>)
  ) {
    return true;
  }
  if (
    "shape" in schema &&
    schema.shape &&
    typeof schema.shape === "object" &&
    !Array.isArray(schema.shape) &&
    "via" in (schema.shape as Record<string, unknown>)
  ) {
    return true;
  }
  return false;
}
