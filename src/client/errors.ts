/**
 * Typed error narrowing for the client result envelope.
 *
 * Flow failures are values (`{ data: null, error }`). Narrow with
 * `error.code === "FlightFull"` — TypeScript then knows `error.data`.
 */

import type { ClientResult, TransportError } from "./types.ts";

/**
 * True when `error` is a transport / protocol failure.
 *
 * @param error - Client error value
 */
export function isTransportError(
  error: { readonly code: string; readonly data?: unknown } | null | undefined,
): error is TransportError {
  return error?.code === "TransportError";
}

/**
 * Narrow a client error to one declared code.
 *
 * Prefer `error?.code === "FlightFull"` for inference; use this when
 * you need a type predicate in a helper.
 *
 * @param error - Error value from a {@link ClientResult}
 * @param code - Declared error code
 */
export function isErrorCode<
  Err extends { readonly code: string; readonly data: unknown },
  C extends Err["code"],
>(error: Err | null | undefined, code: C): error is Extract<Err, { readonly code: C }> {
  return error != null && error.code === code;
}

/**
 * True when the result is a failure (flow or transport).
 *
 * @param result - Client call result
 */
export function isFail<O, E extends Record<string, unknown>>(
  result: ClientResult<O, E>,
): result is Extract<ClientResult<O, E>, { readonly data: null }> {
  return result.error !== null;
}

/**
 * True when the result is a success.
 *
 * @param result - Client call result
 */
export function isOk<O, E extends Record<string, unknown>>(
  result: ClientResult<O, E>,
): result is Extract<ClientResult<O, E>, { readonly error: null }> {
  return result.error === null;
}
