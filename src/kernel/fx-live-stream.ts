/**
 * `fx.live` SSE + Last-Event-ID resume — lazy so Store-only `oke()` graphs
 * do not pin `checkLiveResume` / 410 encoding.
 *
 * Do not import `fx.ts` (type or value): that cycle pulls `createFx` into
 * this chunk the same way a static `fx-auth-keys` import would.
 */

import { currentAbortSignal, linkAbort } from "./abort-scope.ts";
import { isDryRun } from "./dry-run.ts";
import type { EffectKind } from "./effects.ts";

const jsonResultBrand = Symbol.for("oke.json");
const sseFrameBrand = Symbol.for("oke.sse.frame");

function sseFrame(data: unknown, id?: string): unknown {
  return id !== undefined ? { [sseFrameBrand]: true, data, id } : { [sseFrameBrand]: true, data };
}

/** Minimal bus surface used by {@link createLiveStream}. */
export interface LiveStreamRuntime {
  live(
    name: string,
    opts?: { readonly afterId?: string },
  ): AsyncIterable<{ readonly id: string; readonly payload: unknown }>;
  checkLiveResume(name: string, afterId: string): Promise<void>;
}

/** Capability gate used by {@link createLiveStream}. */
export type LiveStreamGate = <T>(
  kind: EffectKind,
  resource: string,
  body: () => T | Promise<T>,
) => Promise<T>;

/** Options for {@link createLiveStream}. */
export interface CreateLiveStreamOptions {
  readonly name: string;
  readonly afterId?: string;
  readonly match?: (payload: unknown) => boolean;
  readonly gated: LiveStreamGate;
  readonly signalRuntime: LiveStreamRuntime | undefined;
}

/**
 * SSE carrier from {@link createLiveStream}.
 *
 * Runtime brand is `Symbol.for("oke.json")` — same as `fx.json.stream`.
 * Callers in `fx.ts` assert this onto `JsonStreamResult`.
 */
export interface LiveStreamResult {
  readonly kind: "stream";
  readonly status: 200;
  readonly chunks: AsyncIterable<unknown>;
  ready?: () => Promise<void>;
  finalize?: () => Promise<void>;
}

/**
 * Build the SSE carrier for `fx.live`.
 *
 * @param options - Signal name, cursor, gate, runtime
 */
export function createLiveStream(options: CreateLiveStreamOptions): LiveStreamResult {
  const { name, afterId, match, gated, signalRuntime } = options;
  const bind = async (): Promise<boolean> => {
    await gated("read", `signal:${name}`, async () => undefined);
    if (isDryRun()) return false;
    if (!signalRuntime) throw new Error("fx.live requires a bound signal runtime");
    return true;
  };
  const chunks = (async function* () {
    if (!(await bind())) return;
    const ambient = currentAbortSignal();
    const local = new AbortController();
    const unlink = linkAbort(ambient, local);
    const iter = signalRuntime!.live(name, { afterId })[Symbol.asyncIterator]();
    const onAbort = (): void => {
      void iter.return?.();
    };
    local.signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        if (local.signal.aborted) break;
        const step = await iter.next();
        if (step.done || local.signal.aborted) break;
        if (match && !match(step.value.payload)) continue;
        yield sseFrame(step.value.payload, step.value.id);
      }
    } finally {
      local.signal.removeEventListener("abort", onAbort);
      unlink();
      await iter.return?.();
      if (!local.signal.aborted) local.abort();
    }
  })();
  const carrier: LiveStreamResult = {
    kind: "stream",
    status: 200,
    chunks,
    ready: async () => {
      if (afterId && (await bind())) await signalRuntime!.checkLiveResume(name, afterId);
    },
  };
  // Brand at runtime (`isJsonStreamResult`); not on {@link LiveStreamResult}
  // so this file does not import `fx.ts` unique-symbol types (cycle / TS2353).
  return Object.assign(carrier, { [jsonResultBrand]: true });
}

/**
 * Map OKE1014 to HTTP 410 `{ error: { code: "LiveResumeGap" } }`.
 *
 * @param err - Thrown value
 */
export function encodeGap(err: unknown): Response | undefined {
  const o = err as { code?: unknown; params?: { signal?: string; afterId?: string } };
  if (o?.code !== 1014) return;
  return Response.json(
    {
      data: null,
      error: {
        code: "LiveResumeGap",
        data: { signal: o.params?.signal ?? "", afterId: o.params?.afterId ?? "" },
      },
    },
    { status: 410 },
  );
}

/**
 * Await stream `ready` before the 200 SSE body.
 *
 * @param stream - Live / json.stream carrier
 * @returns 410 response when the cursor is missing; otherwise `undefined`
 */
export async function awaitLiveReady(stream: {
  readonly ready?: () => Promise<void>;
  readonly finalize?: () => Promise<void>;
}): Promise<Response | undefined> {
  try {
    await stream.ready?.();
  } catch (err) {
    await stream.finalize?.();
    const gap = encodeGap(err);
    if (gap) return gap;
    throw err;
  }
  return undefined;
}
