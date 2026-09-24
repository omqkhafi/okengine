/**
 * Client live subscribe — fetch SSE, callback + unsubscribe.
 */

import type { LiveExposure } from "./route-tables.ts";
import { iterateSseFrames, sseError } from "./sse.ts";
import type { ClientFetch, ClientOptions, LiveHandlers, LiveUnsubscribe } from "./types.ts";
import {
  applyAuthHeader,
  applyHeaderBag,
  interpolatePath,
  resolveHeaders,
  toQuery,
} from "./wire.ts";

/** First wait after a drop when {@link LiveHandlers.autoResubscribe} is true. */
export const LIVE_RESUBSCRIBE_INITIAL_MS = 500;

/** Cap for autoResubscribe exponential backoff. */
export const LIVE_RESUBSCRIBE_MAX_MS = 30_000;

/**
 * Next backoff after `delayMs` (`initial * 2^n`, capped).
 *
 * @param delayMs - Current delay
 */
export function nextResubscribeDelay(delayMs: number): number {
  return Math.min(Math.max(delayMs, LIVE_RESUBSCRIBE_INITIAL_MS) * 2, LIVE_RESUBSCRIBE_MAX_MS);
}

/**
 * Open an SSE subscription. `unsubscribe` aborts and drops in-flight frames.
 *
 * @param base - Origin
 * @param exposure - Route
 * @param input - Path/query fields
 * @param handlers - Callbacks
 * @param opts - Client options (auth, headers, fetch)
 */
export function subscribeLive(
  base: string,
  exposure: LiveExposure,
  input: unknown,
  handlers: LiveHandlers<unknown>,
  opts: ClientOptions,
): LiveUnsubscribe {
  const ctrl = new AbortController();
  const onAbort = (): void => {
    ctrl.abort();
  };
  handlers.signal?.addEventListener("abort", onAbort, { once: true });
  const run = pump(base, exposure, input, handlers, opts, ctrl.signal);
  void run;
  return () => {
    handlers.signal?.removeEventListener("abort", onAbort);
    ctrl.abort();
  };
}

async function pump(
  base: string,
  exposure: LiveExposure,
  input: unknown,
  handlers: LiveHandlers<unknown>,
  opts: ClientOptions,
  signal: AbortSignal,
): Promise<void> {
  const auto = handlers.autoResubscribe === true;
  let delayMs = LIVE_RESUBSCRIBE_INITIAL_MS;
  let attempt = 0;
  let lastSeenId: string | undefined;
  /** Report `err`. Returns whether the loop should resubscribe. */
  const note = (err: unknown): boolean => {
    handlers.onError?.(err);
    return auto;
  };
  for (;;) {
    if (signal.aborted) return;
    if (attempt > 0 && auto) {
      await sleep(delayMs, signal);
      if (signal.aborted) return;
      delayMs = nextResubscribeDelay(delayMs);
    }
    attempt += 1;
    try {
      let res = await openSse(base, exposure, input, opts, signal, lastSeenId);
      if (signal.aborted) return;
      if (res.status === 401 && opts.auth?.refresh) {
        await opts.auth.refresh();
        res = await openSse(base, exposure, input, opts, signal, lastSeenId);
        if (signal.aborted) return;
      }
      if (res.status === 410) {
        lastSeenId = undefined;
        const text = await res.text().catch(() => "");
        if (note(sseError(410, text))) continue;
        return;
      }
      lastSeenId = await consumeSse(res, handlers, signal, lastSeenId);
      if (signal.aborted) return;
      if (note(new Error("live connection closed"))) continue;
      return;
    } catch (err) {
      if (signal.aborted) return;
      if (note(err)) continue;
      return;
    }
  }
}

async function consumeSse(
  res: Response,
  handlers: LiveHandlers<unknown>,
  signal: AbortSignal,
  lastSeenId: string | undefined,
): Promise<string | undefined> {
  let cursor = lastSeenId;
  for await (const frame of iterateSseFrames(res, signal, handlers.onOpen)) {
    handlers.onEvent(frame.event);
    if (frame.id !== undefined && frame.id.length > 0) cursor = frame.id;
  }
  return cursor;
}

/**
 * Abortable delay. Resolves immediately when `signal` is already aborted.
 *
 * @param ms - Duration
 * @param signal - Unsubscribe / caller abort
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function openSse(
  base: string,
  exposure: LiveExposure,
  input: unknown,
  opts: ClientOptions,
  signal: AbortSignal,
  lastSeenId?: string,
): Promise<Response> {
  const { url, method } = restGet(base, exposure.path, input);
  const headers = new Headers({ accept: "text/event-stream" });
  applyHeaderBag(headers, await resolveHeaders(opts));
  await applyAuthHeader(headers, opts);
  if (lastSeenId) headers.set("last-event-id", lastSeenId);
  const fetchFn: ClientFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  return fetchFn(url, {
    method,
    headers,
    signal,
    ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
  });
}

function restGet(base: string, path: string, input: unknown): { url: string; method: string } {
  const { path: pathOut, rest } = interpolatePath(path, input);
  return { url: `${base}${pathOut}${toQuery(rest)}`, method: "GET" };
}
