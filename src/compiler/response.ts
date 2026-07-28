/**
 * Canonical HTTP encoding for flow results.
 *
 * Shared by AoT and dynamic so responses stay byte-identical.
 */

import type { FlowFailure } from "../kernel/errors.ts";
import { isFlowFailure } from "../kernel/hooks.ts";
import { VALIDATION_ERROR_CODE } from "../validation/standard-schema.ts";

/** Successful envelope. */
export interface SuccessEnvelope {
  readonly data: unknown;
  readonly error: null;
}

/** Failure envelope. */
export interface FailureEnvelope {
  readonly data: null;
  readonly error: FlowFailure["error"];
}

/**
 * HTTP status for a flow-boundary failure.
 *
 * Gate denials use the status the Gates simulator promises:
 * `Unauthorized` → 401 · `Forbidden` → 403 · `RateLimited` → 429.
 *
 * @param failure - Typed failure
 */
export function statusForFailure(failure: FlowFailure): number {
  switch (failure.error.code) {
    case VALIDATION_ERROR_CODE:
      return 422;
    case "Unauthorized":
      return 401;
    case "Forbidden":
      return 403;
    case "RateLimited":
      return 429;
    default:
      return 400;
  }
}

/**
 * Encode a successful output as JSON `{ data, error: null }`.
 *
 * @param output - Handler output (`undefined` → 204)
 */
export function encodeSuccess(output: unknown): Response {
  if (output === undefined) {
    return new Response(null, { status: 204 });
  }
  return Response.json({ data: output, error: null } satisfies SuccessEnvelope);
}

/**
 * Encode a typed flow failure as JSON `{ data: null, error }`.
 *
 * @param failure - Flow-boundary failure
 */
export function encodeFailure(failure: FlowFailure): Response {
  return Response.json({ data: null, error: failure.error } satisfies FailureEnvelope, {
    status: statusForFailure(failure),
  });
}

/**
 * Encode an execute-style result (response / failure / output).
 *
 * @param result - Pipeline outcome pieces
 */
export function encodeExecuteResult(result: {
  readonly response?: Response | undefined;
  readonly failure?: FlowFailure | undefined;
  readonly output?: unknown;
  readonly error?: unknown;
}): Response {
  if (result.response) return result.response;
  if (result.failure) return encodeFailure(result.failure);
  if (result.error !== undefined && isFlowFailure(result.error)) {
    return encodeFailure(result.error);
  }
  return encodeSuccess(result.output);
}
