/**
 * Finite SSE stream consumer for `fx.json.stream` Flows.
 *
 * @module
 */

import { iterateSse, sseError } from "./sse.ts";
import type { ClientFetch, ClientHeaders, ClientOptions, ClientRouteMap } from "./types.ts";

/** Flow id → REST route for stream-only (non-live) SSE. */
export type StreamByFlow = Readonly<
  Record<string, { readonly method: string; readonly path: string }>
>;

/**
 * Collect `stream: true` routes that are not live exposures.
 *
 * @param $routes - Runtime route map
 */
export function flattenStreamRoutes($routes: ClientRouteMap | undefined): StreamByFlow {
  const out: Record<string, { readonly method: string; readonly path: string }> = {};
  if (!$routes) return out;
  for (const [unit, flows] of Object.entries($routes)) {
    if (!flows || typeof flows !== "object") continue;
    for (const [flow, contract] of Object.entries(flows)) {
      if (!contract || typeof contract !== "object") continue;
      if (!("stream" in contract) || contract.stream !== true) continue;
      if ("live" in contract && typeof contract.live === "string") continue;
      const method = "method" in contract ? contract.method : undefined;
      const path = "path" in contract ? contract.path : undefined;
      if (typeof method === "string" && typeof path === "string") {
        out[`${unit}.${flow}`] = { method, path };
      }
    }
  }
  return out;
}

/**
 * Open a one-shot SSE stream (no auto-resubscribe).
 *
 * @param base - Origin
 * @param route - REST method/path
 * @param input - JSON body / path params
 * @param opts - Client options
 */
export async function* openStream(
  base: string,
  route: { readonly method: string; readonly path: string },
  input: unknown,
  opts: ClientOptions,
): AsyncGenerator<unknown> {
  const fetchFn: ClientFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let refreshed = false;
  for (;;) {
    const ctrl = new AbortController();
    const parent = opts.signal;
    if (parent) {
      if (parent.aborted) {
        ctrl.abort();
      } else {
        parent.addEventListener("abort", () => ctrl.abort(), { once: true });
      }
    }
    const { url, method, body } = streamRequest(base, route.method, route.path, input);
    const headers = new Headers({ accept: "text/event-stream" });
    const extra = typeof opts.headers === "function" ? await opts.headers() : opts.headers;
    applyHeaders(headers, extra);
    if (body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const token =
      opts.auth && "getToken" in opts.auth && typeof opts.auth.getToken === "function"
        ? await opts.auth.getToken()
        : undefined;
    if (token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const res = await fetchFn(url, {
      method,
      headers,
      body,
      signal: ctrl.signal,
      ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
    });
    if (res.status === 401 && opts.auth && "refresh" in opts.auth && typeof opts.auth.refresh === "function" && !refreshed) {
      refreshed = true;
      await opts.auth.refresh();
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw sseError(res.status, text);
    }
    yield* iterateSse(res, ctrl.signal);
    return;
  }
}

function streamRequest(
  base: string,
  method: string,
  path: string,
  input: unknown,
): { url: string; method: string; body: string | undefined } {
  const params =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  let pathOut = path;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const token = `:${k}`;
    if (pathOut.includes(token)) {
      pathOut = pathOut.replaceAll(token, encodeURIComponent(String(v)));
    } else {
      rest[k] = v;
    }
  }
  const upper = method.toUpperCase();
  let body: string | undefined;
  if (upper === "GET" || upper === "HEAD") {
    const query: string[] = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) {
        query.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    const qs = query.length ? `?${query.join("&")}` : "";
    return { url: `${base}${pathOut}${qs}`, method: upper, body: undefined };
  }
  body = JSON.stringify(Object.keys(rest).length > 0 ? rest : (input ?? {}));
  return { url: `${base}${pathOut}`, method: upper, body };
}

function applyHeaders(headers: Headers, extra: ClientHeaders | undefined): void {
  if (!extra) return;
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) headers.set(k, v);
  } else {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
}
