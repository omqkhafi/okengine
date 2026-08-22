/**
 * Canonical HTTP encoding for flow results.
 *
 * Shared by AoT and dynamic so responses stay byte-identical.
 */

import type { FlowFailure } from "../kernel/errors.ts";
import type { JsonResult, JsonStreamResult, SseFrame } from "../kernel/fx.ts";
import { isFlowFailure } from "../kernel/hooks.ts";
import { lazyRequire } from "../kernel/lazy-require.ts";
import { VALIDATION_ERROR_CODE } from "../validation/standard-schema.ts";

/** Successful envelope. */
export interface SuccessEnvelope {
  readonly data: unknown;
  readonly error: null;
  readonly meta?: Record<string, unknown>;
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
 * An `fx.json` carrier overrides status (`create` → 201) and attaches
 * top-level `meta` (Stripe-style envelope).
 *
 * @param output - Handler output (`undefined` → 204)
 */
export function encodeSuccess(output: unknown): Response {
  const json = loadFxJson();
  if (json.isJsonStreamResult(output)) {
    return encodeSseStream(output);
  }
  if (json.isJsonResult(output)) {
    if (output.status === 204) {
      return new Response(null, { status: 204 });
    }
    const body: SuccessEnvelope = { data: output.value, error: null };
    const envelope = output.meta === undefined ? body : { ...body, meta: output.meta };
    return Response.json(envelope, { status: output.status });
  }
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

function loadFxLiveStream(): typeof import("../kernel/fx-live-stream.ts") {
  return lazyRequire(`${import.meta.dir}/../kernel`, ["fx", "live", "stream"].join("-"));
}

function loadFxJson(): {
  isJsonResult: (value: unknown) => value is JsonResult;
  isJsonStreamResult: (value: unknown) => value is JsonStreamResult;
  isSseFrame: (value: unknown) => value is SseFrame;
} {
  return lazyRequire(`${import.meta.dir}/../kernel`, ["fx", "runtime"].join("-"));
}

/**
 * Encode an execute-style result (response / failure / output).
 *
 * Awaits {@link JsonStreamResult.ready} before the 200 SSE body so OKE1014
 * can return 410 instead of a half-open stream.
 *
 * @param result - Pipeline outcome pieces
 */
export async function encodeExecuteResult(result: {
  readonly response?: Response | undefined;
  readonly failure?: FlowFailure | undefined;
  readonly output?: unknown;
  readonly error?: unknown;
}): Promise<Response> {
  if (result.response) return result.response;
  if (result.failure) return encodeFailure(result.failure);
  if (result.error !== undefined) {
    if (isFlowFailure(result.error)) {
      return encodeFailure(result.error);
    }
    const gap =
      result.error !== null &&
      typeof result.error === "object" &&
      "code" in result.error &&
      (result.error as { code: unknown }).code === 1014
        ? loadFxLiveStream().encodeGap(result.error)
        : undefined;
    if (gap) return gap;
    // Unhandled throws must never look like success (`undefined` → 204).
    return Response.json(
      {
        data: null,
        error: {
          code: "InternalError",
          data: {},
          message: result.error instanceof Error ? result.error.message : "internal error",
        },
      } satisfies FailureEnvelope,
      { status: 500 },
    );
  }
  if (loadFxJson().isJsonStreamResult(result.output) && result.output.ready) {
    const early = await loadFxLiveStream().awaitLiveReady(result.output);
    if (early) return early;
  }
  return encodeSuccess(result.output);
}

function encodeSseStream(carrier: JsonStreamResult): Response {
  const encoder = new TextEncoder();
  let finalized = false;
  const finish = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    await carrier.finalize?.();
  };
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of carrier.chunks) {
          const frame = loadFxJson().isSseFrame(chunk)
            ? chunk
            : { data: chunk as unknown, id: undefined as string | undefined };
          const lines: string[] = [];
          if (frame.id !== undefined) lines.push(`id: ${frame.id}`);
          lines.push(`data: ${JSON.stringify(frame.data)}`);
          controller.enqueue(encoder.encode(`${lines.join("\n")}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        await finish();
      }
    },
    cancel() {
      void finish();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
