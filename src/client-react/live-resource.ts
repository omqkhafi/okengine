/**
 * SSE subscription to a resource live route (`GET <path>/live`).
 *
 * Same fetch-SSE physics as `client/live.ts` (frame parsing, backoff,
 * auth), typed for the classified row-event taxonomy. Classified events are
 * per-connection — there is no shared tape, so gaps cannot resume by
 * cursor; consumers heal with a list refetch instead.
 *
 * @module
 */

import type { ClientFetch, ClientHeaders } from "../client/types.ts";
import type { LiveQueryEvent } from "../client/use-live-query.ts";

/** First reconnect wait after a drop (mirrors `LIVE_RESUBSCRIBE_INITIAL_MS`). */
const RESUBSCRIBE_INITIAL_MS = 500;

/** Reconnect cap (mirrors `LIVE_RESUBSCRIBE_MAX_MS`). */
const RESUBSCRIBE_MAX_MS = 30_000;

/** Frames accepted by {@link subscribeLiveResource}. */
export interface ResourceStreamHandlers<Row> {
  readonly onEvent: (event: LiveQueryEvent<Row>) => void;
  readonly onOpen?: () => void;
  /** Stream error or close while `autoResubscribe` recovers (or terminally). */
  readonly onError?: (error: unknown) => void;
}

/** Options for {@link subscribeLiveResource}. */
export interface ResourceStreamOptions {
  /** Re-open after a drop with 500ms→30s backoff. Default false. */
  readonly autoResubscribe?: boolean;
  /** Headers or per-request getter (Bearer token etc.). */
  readonly headers?: ClientHeaders | (() => ClientHeaders | Promise<ClientHeaders>);
  /** Auth token getter (`opts.auth.getToken` passthrough). */
  readonly getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Override `globalThis.fetch`. */
  readonly fetch?: ClientFetch;
  /** Cross-cutting abort (component teardown uses the returned stop fn). */
  readonly signal?: AbortSignal;
}

/** Stop consuming and close the stream. Idempotent. */
export type ResourceStreamStop = () => void;

/**
 * Open an SSE subscription to one resource's live route.
 *
 * Query fields serialize onto the URL exactly like the list request
 * (`restGet` grammar: `:param` substitution then query string), so the
 * server re-derives the identical list window for classification.
 *
 * @param base - App origin
 * @param route - `{ method, path }` from `$routes`
 * @param query - List filters
 * @param handlers - Event callbacks
 * @param options - Backoff / headers / auth token / fetch
 */
export function subscribeLiveResource<Row extends Record<string, unknown>>(
  base: string,
  route: { readonly method: string; readonly path: string },
  query: unknown,
  handlers: ResourceStreamHandlers<Row>,
  options: ResourceStreamOptions = {},
): ResourceStreamStop {
  const ctrl = new AbortController();
  const outerAbort = (): void => {
    ctrl.abort();
  };
  options.signal?.addEventListener("abort", outerAbort, { once: true });
  void pump(base, route, query, handlers, options, ctrl.signal);
  return () => {
    options.signal?.removeEventListener("abort", outerAbort);
    ctrl.abort();
  };
}

async function pump<Row>(
  base: string,
  route: { readonly method: string; readonly path: string },
  query: unknown,
  handlers: ResourceStreamHandlers<Row>,
  options: ResourceStreamOptions,
  signal: AbortSignal,
): Promise<void> {
  const auto = options.autoResubscribe === true;
  let delayMs = RESUBSCRIBE_INITIAL_MS;
  let first = true;
  for (;;) {
    if (signal.aborted) return;
    if (!first && auto) {
      await sleep(delayMs, signal);
      if (signal.aborted) return;
      delayMs = Math.min(delayMs * 2, RESUBSCRIBE_MAX_MS);
    }
    first = false;
    try {
      const res = await openSse(base, route, query, options, signal);
      if (signal.aborted) return;
      handlers.onOpen?.();
      await consume(res, handlers, signal);
      if (signal.aborted) return;
      handlers.onError?.(new Error("live connection closed"));
      if (!auto) return;
    } catch (err) {
      if (signal.aborted) return;
      handlers.onError?.(err);
      if (!auto) return;
    }
  }
}

async function openSse(
  base: string,
  route: { readonly method: string; readonly path: string },
  query: unknown,
  options: ResourceStreamOptions,
  signal: AbortSignal,
): Promise<Response> {
  const url = streamUrl(base, route.path, query);
  const headers = new Headers({ accept: "text/event-stream" });
  const extra = typeof options.headers === "function" ? await options.headers() : options.headers;
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) headers.set(k, v);
  } else if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  const token = options.getToken ? await options.getToken() : undefined;
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const fetchFn: ClientFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  return fetchFn(url, { method: "GET", headers, signal });
}

function streamUrl(base: string, path: string, query: unknown): string {
  const params = query !== null && typeof query === "object" ? query : {};
  let out = path;
  const qs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const token = `:${k}`;
    if (out.includes(token)) {
      out = out.replaceAll(token, encodeURIComponent(String(v)));
    } else if (v !== undefined) {
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return `${base}${out}${qs.length > 0 ? `?${qs.join("&")}` : ""}`;
}

async function consume<Row>(
  res: Response,
  handlers: ResourceStreamHandlers<Row>,
  signal: AbortSignal,
): Promise<void> {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw sseError(res.status, text);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    throw sseError(res.status, "");
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
        dispatchFrame(raw, handlers, signal);
        if (signal.aborted) return;
        sep = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame<Row>(
  raw: string,
  handlers: ResourceStreamHandlers<Row>,
  signal: AbortSignal,
): void {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0 || signal.aborted) return;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isLiveQueryEvent(parsed)) return;
    handlers.onEvent(parsed as LiveQueryEvent<Row>);
  } catch {
    // Malformed frame — skip; next valid frame keeps state convergent.
  }
}

function isLiveQueryEvent(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string") return false;
  if (v.kind === "upsert") return typeof v.row === "object" && v.row !== null;
  return (v.kind === "revoked" || v.kind === "delete") && typeof v.id === "string";
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
