/**
 * Client live subscribe — fetch SSE, callback + unsubscribe.
 */

import type { ClientFetch, ClientOptions, ClientRouteMap, FlowContract } from "./types.ts";
import type { LiveHandlers, LiveUnsubscribe } from "./types.ts";

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
  if (!$routes) return { bySignal, byFlow };
  for (const [unit, flows] of Object.entries($routes)) {
    if (!flows || typeof flows !== "object") continue;
    for (const [flow, contract] of Object.entries(flows)) {
      if (!contract || typeof contract !== "object") continue;
      const live = liveName(contract);
      const method = "method" in contract ? contract.method : undefined;
      const path = "path" in contract ? contract.path : undefined;
      if (typeof live !== "string" || typeof method !== "string" || typeof path !== "string") {
        continue;
      }
      const matchKey = matchKeyOf(contract);
      const id = `${unit}.${flow}`;
      const exposure: LiveExposure = { flow: id, method, path, matchKey };
      (bySignal[live] ??= []).push(exposure);
      byFlow[id] = exposure;
    }
  }
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
    if (!hit) {
      throw new Error(
        `Unknown live via "${via}". Known: ${exposures.map((e) => e.flow).join(", ")}`,
      );
    }
    return hit;
  }
  const keys =
    input !== null && typeof input === "object"
      ? Object.keys(input as Record<string, unknown>)
      : [];
  const candidates = exposures.filter((e) => e.matchKey.every((k) => keys.includes(k)));
  if (candidates.length === 0) {
    throw new Error(
      `No live exposure matches input keys [${keys.join(", ")}]. Flows: ${exposures.map((e) => e.flow).join(", ")}`,
    );
  }
  let max = -1;
  for (const e of candidates) {
    if (e.matchKey.length > max) max = e.matchKey.length;
  }
  const top = candidates.filter((e) => e.matchKey.length === max);
  if (top.length !== 1) {
    throw new Error(
      `Multiple live exposures match: ${top.map((e) => e.flow).join(", ")}. Pass via: "unit.flow".`,
    );
  }
  return top[0]!;
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
  for (;;) {
    if (signal.aborted) return;
    try {
      const res = await openSse(base, exposure, input, opts, signal);
      if (signal.aborted) return;
      if (res.status === 401 && opts.auth?.refresh) {
        await opts.auth.refresh();
        const retry = await openSse(base, exposure, input, opts, signal);
        if (signal.aborted) return;
        await readSse(retry, handlers.onEvent, signal);
        if (signal.aborted) return;
        const closed = new Error("live connection closed");
        if (auto) {
          handlers.onError?.(closed);
          continue;
        }
        handlers.onError?.(closed);
        return;
      }
      await readSse(res, handlers.onEvent, signal);
      if (signal.aborted) return;
      const closed = new Error("live connection closed");
      if (auto) {
        handlers.onError?.(closed);
        continue;
      }
      handlers.onError?.(closed);
      return;
    } catch (err) {
      if (signal.aborted) return;
      if (auto) {
        handlers.onError?.(err);
        continue;
      }
      handlers.onError?.(err);
      return;
    }
  }
}

async function openSse(
  base: string,
  exposure: LiveExposure,
  input: unknown,
  opts: ClientOptions,
  signal: AbortSignal,
): Promise<Response> {
  const { url, method } = restGet(base, exposure.path, input);
  const headers = new Headers({ accept: "text/event-stream" });
  const extra = typeof opts.headers === "function" ? await opts.headers() : opts.headers;
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) headers.set(k, v);
  } else if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  const token = opts.auth ? await opts.auth.getToken() : undefined;
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const fetchFn: ClientFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  return fetchFn(url, { method, headers, signal });
}

function restGet(base: string, path: string, input: unknown): { url: string; method: string } {
  const params =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  let pathOut = path;
  const query: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const token = `:${k}`;
    if (pathOut.includes(token)) {
      pathOut = pathOut.replaceAll(token, encodeURIComponent(String(v)));
    } else if (v !== undefined) {
      query.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return { url: `${base}${pathOut}${qs}`, method: "GET" };
}

async function readSse(
  res: Response,
  onEvent: (event: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text);
  }
  if (!ct.includes("text/event-stream")) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text || `Expected text/event-stream, got ${ct || "none"}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep = buf.indexOf("\n\n");
      while (sep >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const stop = dispatchFrame(raw, onEvent, signal);
        if (stop || signal.aborted) return;
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(
  raw: string,
  onEvent: (event: unknown) => void,
  signal: AbortSignal,
): boolean {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return false;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return true;
  if (signal.aborted) return true;
  onEvent(JSON.parse(data) as unknown);
  return false;
}

function sseError(status: number, body: string): Error {
  let message = `HTTP ${status}`;
  if (body) {
    try {
      const json: unknown = JSON.parse(body);
      if (json !== null && typeof json === "object" && "error" in json) {
        const err = (json as { error?: { code?: string; data?: { message?: string } } }).error;
        message = err?.data?.message ?? err?.code ?? message;
      }
    } catch {
      message = body.slice(0, 200);
    }
  }
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}
