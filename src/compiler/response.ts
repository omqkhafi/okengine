/**
 * Canonical HTTP encoding for flow results.
 *
 * Shared by AoT and dynamic so responses stay byte-identical.
 */

import { fail, type FlowFailure } from "../kernel/errors.ts";
import type { JsonResult, JsonStreamResult, SseFrame } from "../kernel/fx.ts";
import { readSseId } from "../kernel/sse-id.ts";
import { isFlowFailure } from "../kernel/hooks.ts";
import { lazyRequire } from "../kernel/lazy-require.ts";

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
 * Built-in codes use {@link httpStatusForFailure}. Domain codes default to 400.
 *
 * @param failure - Typed failure
 */
export function statusForFailure(failure: FlowFailure): number {
  return loadBuiltinErrors().httpStatusForFailure(failure.error.code, failure.error.data);
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

function loadBuiltinErrors(): typeof import("../kernel/builtin-errors.ts") {
  return lazyRequire(`${import.meta.dir}/../kernel`, ["builtin", "errors"].join("-"));
}

function loadStoreErrors(): typeof import("../elements/store/store-errors.ts") {
  return lazyRequire(`${import.meta.dir}/../elements/store`, ["store", "errors"].join("-"));
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
 * Awaits {@link JsonStreamResult.ready} before the 200 SSE body so OKE1210
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
      (result.error as { code: unknown }).code === 1210
        ? loadFxLiveStream().encodeGap(result.error)
        : undefined;
    if (gap) return gap;
    const storeMapped = loadStoreErrors().storeErrorToFailure(result.error, {
      retryable: "unavailable",
    });
    if (storeMapped) return encodeFailure(storeMapped);
    // Unhandled throws must never look like success (`undefined` → 204).
    // Catalog message only — never copy the thrown `Error.message`.
    return encodeFailure(fail("InternalError", {}));
  }
  if (loadFxJson().isJsonStreamResult(result.output) && result.output.ready) {
    const early = await loadFxLiveStream().awaitLiveReady(result.output);
    if (early) return early;
  }
  return encodeSuccess(result.output);
}

/**
 * Durable park thrown from a streamed agent after the interrupt frame.
 *
 * Duck-typed so this encoder does not import the journal module.
 *
 * @param err - Value thrown by the chunk iterator
 */
function isStreamPark(err: unknown): err is { readonly wakeAt: number; readonly label: string } {
  return (
    err instanceof Error &&
    err.name === "JournalSuspend" &&
    "wakeAt" in err &&
    typeof err.wakeAt === "number" &&
    "label" in err &&
    typeof err.label === "string"
  );
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
            : { data: chunk as unknown, id: readSseId(chunk) };
          const lines: string[] = [];
          if ("comment" in frame && frame.comment && frame.data === undefined) {
            controller.enqueue(encoder.encode(`: ${frame.comment}\n\n`));
            continue;
          }
          if (frame.id !== undefined) lines.push(`id: ${frame.id}`);
          lines.push(`data: ${JSON.stringify(frame.data)}`);
          controller.enqueue(encoder.encode(`${lines.join("\n")}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        if (isStreamPark(err)) {
          carrier.parked = { wakeAt: err.wakeAt, label: err.label };
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } else {
          controller.error(err);
        }
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
