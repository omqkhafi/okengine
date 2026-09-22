/**
 * Client live subscribe — fetch SSE, callback + unsubscribe.
 */

import type { ClientFetch, ClientOptions, ClientRouteMap, FlowContract } from "./types.ts";
import type { LiveHandlers, LiveUnsubscribe } from "./types.ts";
import { iterateSseFrames, sseError } from "./sse.ts";
import {
  applyAuthHeader,
  applyHeaderBag,
  interpolatePath,
  methodAndPath,
  resolveHeaders,
  toQuery,
  walkContracts,
} from "./wire.ts";

/** One HTTP exposure of a live signal. */
export interface LiveExposure {
  readonly flow: string;
  readonly method: string;
  readonly path: string;
  readonly matchKey: readonly string[];
}

/** Signal name → exposures (multiple audiences). */
export type LiveRouteTable = Readonly<Record<string, readonly LiveExposure[]>>;

/** Flow id (`unit.flow`) → exposure. */
export type LiveByFlow = Readonly<Record<string, LiveExposure>>;

/**
 * Build live route tables from `app.$routes`.
 *
 * @param $routes - Runtime route map
 */
export function flattenLiveRoutes($routes: ClientRouteMap | undefined): {
  readonly bySignal: LiveRouteTable;
  readonly byFlow: LiveByFlow;
} {
  const bySignal: Record<string, LiveExposure[]> = {};
  const byFlow: Record<string, LiveExposure> = {};
  walkContracts($routes, (unit, flow, contract) => {
    const live = liveName(contract);
    const route = methodAndPath(contract);
    if (typeof live !== "string" || !route) return;
    const matchKey = matchKeyOf(contract);
    const id = `${unit}.${flow}`;
    const exposure: LiveExposure = { flow: id, method: route.method, path: route.path, matchKey };
    (bySignal[live] ??= []).push(exposure);
    byFlow[id] = exposure;
  });
  return { bySignal, byFlow };
}

function liveName(contract: FlowContract): string | undefined {
  return "live" in contract && typeof contract.live === "string" ? contract.live : undefined;
}

function matchKeyOf(contract: FlowContract): readonly string[] {
  if ("matchKey" in contract && Array.isArray(contract.matchKey)) {
    return contract.matchKey.filter((k): k is string => typeof k === "string");
  }
  return [];
}

/** True when `value` is a handlers bag (`onEvent` present). */
export function isLiveHandlers(value: unknown): value is LiveHandlers<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LiveHandlers<unknown>).onEvent === "function"
  );
}

/**
 * Pick the unique exposure whose `matchKey` is a subset of `input` keys.
 * Prefer the largest matchKey. Ties require `via`.
 *
 * @param exposures - All exposures for one signal
 * @param input - Filter fields
 * @param via - `unit.flow` disambiguator
 */
export function pickLiveExposure(
  exposures: readonly LiveExposure[],
  input: unknown,
  via?: string,
): LiveExposure {
  if (via) {
    const hit = exposures.find((e) => e.flow === via);
    if (!hit) throw new Error(`Unknown live via "${via}"`);
    return hit;
  }
  const keys =
    input !== null && typeof input === "object"
      ? Object.keys(input as Record<string, unknown>)
      : [];
  const candidates = exposures.filter((e) => e.matchKey.every((k) => keys.includes(k)));
  if (candidates.length === 0) {
    throw new Error(`No live exposure matches input keys [${keys.join(", ")}]`);
  }
  const max = Math.max(...candidates.map((e) => e.matchKey.length));
  const top = candidates.filter((e) => e.matchKey.length === max);
  if (top.length !== 1) {
    throw new Error(`Multiple live exposures match. Pass via: "unit.flow".`);
  }
  return top[0]!;
}

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
