/**
 * Finite SSE stream consumer for `fx.json.stream` Flows.
 *
 * @module
 */

import { iterateSseFrames, sseError } from "./sse.ts";
import type { ClientFetch, ClientOptions } from "./types.ts";
import {
  applyAuthHeader,
  applyHeaderBag,
  interpolatePath,
  resolveHeaders,
  toQuery,
} from "./wire.ts";

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
  const signal = opts.signal ?? new AbortController().signal;
  let refreshed = false;
  for (;;) {
    const { url, method, body } = streamRequest(base, route.method, route.path, input);
    const headers = new Headers({ accept: "text/event-stream" });
    applyHeaderBag(headers, await resolveHeaders(opts));
    if (body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    await applyAuthHeader(headers, opts);
    const res = await fetchFn(url, {
      method,
      headers,
      body,
      signal,
      ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
    });
    if (
      res.status === 401 &&
      opts.auth &&
      "refresh" in opts.auth &&
      typeof opts.auth.refresh === "function" &&
      !refreshed
    ) {
      refreshed = true;
      await opts.auth.refresh();
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw sseError(res.status, text);
    }
    for await (const frame of iterateSseFrames(res, signal)) yield frame.event;
    return;
  }
}

function streamRequest(
  base: string,
  method: string,
  path: string,
  input: unknown,
): { url: string; method: string; body: string | undefined } {
  const { path: pathOut, rest } = interpolatePath(path, input);
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") {
    return { url: `${base}${pathOut}${toQuery(rest)}`, method: upper, body: undefined };
  }
  const body = JSON.stringify(Object.keys(rest).length > 0 ? rest : (input ?? {}));
  return { url: `${base}${pathOut}`, method: upper, body };
}
