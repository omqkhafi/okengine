/**
 * HTTP transport: timeout, retry, and auth refresh.
 *
 * Wire default: `POST {base}/_oke/{unit}/{flow}` with JSON body.
 * Optional `routes` map switches to REST (`method` + path template).
 */

import type {
  ClientBodyInit,
  ClientEnvelope,
  ClientFetch,
  ClientHeaders,
  ClientOptions,
} from "./types.ts";
import {
  applyAuthHeader,
  applyHeaderBag,
  interpolatePath,
  resolveHeaders,
  toQuery,
} from "./wire.ts";

/** Per-call transport options (binary decode, abort). */
export interface TransportCallOptions {
  readonly headers?: ClientHeaders;
  readonly response?: "json" | "blob" | "arrayBuffer";
  readonly signal?: AbortSignal;
}

/** Internal transport handle. */
export interface Transport {
  /**
   * Invoke a flow by `unit/flow` key.
   *
   * @param key - `unit/flow`
   * @param input - JSON body / path-param source
   * @param headersOrOpts - Per-call headers or full call options
   */
  call(
    key: string,
    input: unknown,
    headersOrOpts?: ClientHeaders | TransportCallOptions,
  ): Promise<ClientEnvelope>;
}

/**
 * Create a transport bound to a base URL.
 *
 * @param base - Absolute origin (no trailing slash)
 * @param opts - Client options
 */
export function createTransport(base: string, opts: ClientOptions = {}): Transport {
  const fetchFn: ClientFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = opts.retry?.retries ?? 0;
  const delay0 = opts.retry?.delay ?? 50;
  const backoff = opts.retry?.backoff ?? 2;

  return {
    async call(key, input, headersOrOpts) {
      const callOpts = normalizeCallOpts(headersOrOpts);
      let refreshed = false;
      let attempt = 0;
      let delay = delay0;
      const callClientOpts: ClientOptions =
        callOpts.signal !== undefined ? { ...opts, signal: callOpts.signal } : opts;

      for (;;) {
        try {
          const res = await once(base, key, input, callClientOpts, fetchFn, callOpts.headers);
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
          if (res.status >= 500) {
            const structured = await decodeIfEnvelope(res);
            if (structured) return structured;
            throw new Error(`HTTP ${res.status}`);
          }
          if (callOpts.response === "blob" || callOpts.response === "arrayBuffer") {
            return decodeBinary(res, callOpts.response);
          }
          return decode(res);
        } catch (err) {
          const transient = isTransient(err);
          if (!transient || attempt >= retries) {
            return transportEnvelope(err instanceof Error ? err.message : String(err));
          }
          await sleep(delay);
          delay *= backoff;
          attempt += 1;
        }
      }
    },
  };
}

/**
 * Build a {@link ClientEnvelope} for a transport / protocol failure.
 *
 * Guarantees `error.message === error.data.message`.
 *
 * @param message - Human-readable failure text
 * @param status - Optional HTTP status
 */
export function transportEnvelope(message: string, status?: number): ClientEnvelope {
  return {
    data: null,
    error: {
      code: "TransportError",
      message,
      data: status !== undefined ? { message, status } : { message },
    },
  };
}

function normalizeCallOpts(
  headersOrOpts: ClientHeaders | TransportCallOptions | undefined,
): TransportCallOptions {
  if (headersOrOpts === undefined) return {};
  if (Array.isArray(headersOrOpts)) return { headers: headersOrOpts };
  if (
    typeof headersOrOpts === "object" &&
    ("response" in headersOrOpts || "signal" in headersOrOpts || "headers" in headersOrOpts)
  ) {
    const o = headersOrOpts as TransportCallOptions;
    if (o.response !== undefined || o.signal !== undefined || o.headers !== undefined) {
      return o;
    }
  }
  return { headers: headersOrOpts as ClientHeaders };
}

/**
 * Single HTTP attempt. Throws on network / abort / 5xx (retryable).
 *
 * @param base - Origin
 * @param key - `unit/flow`
 * @param input - Payload
 * @param opts - Options
 * @param fetchFn - Fetch implementation
 * @param _reserved - Reserved
 */
async function once(
  base: string,
  key: string,
  input: unknown,
  opts: ClientOptions,
  fetchFn: ClientFetch,
  callHeaders?: ClientHeaders,
): Promise<Response> {
  const route = opts.routes?.[key.replace("/", ".")];
  const { url, method, body } = route
    ? restRequest(base, route.method, route.path, input)
    : rpcRequest(base, key, input);

  const headers = new Headers();
  applyHeaderBag(headers, await resolveHeaders(opts));
  applyHeaderBag(headers, callHeaders);
  if (body !== undefined && !headers.has("content-type") && typeof body === "string") {
    headers.set("content-type", "application/json");
  }
  await applyAuthHeader(headers, opts);

  const timeout = opts.timeout !== undefined ? AbortSignal.timeout(opts.timeout) : undefined;
  const signal =
    opts.signal && timeout ? AbortSignal.any([opts.signal, timeout]) : (opts.signal ?? timeout);

  return await fetchFn(url, {
    method,
    headers,
    body: body as RequestInit["body"],
    signal,
    ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
  });
}

/**
 * Decode a JSON `{ data, error }` envelope from a 5xx response, or `null`
 * when the body is not a structured OKE failure (retry as transport error).
 *
 * @param res - HTTP response (body consumed)
 */
async function decodeIfEnvelope(res: Response): Promise<ClientEnvelope | null> {
  const text = await res.text();
  if (!text) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json !== null && typeof json === "object" && "data" in json && "error" in json) {
    return json as ClientEnvelope;
  }
  return null;
}

function rpcRequest(
  base: string,
  key: string,
  input: unknown,
): { url: string; method: string; body: ClientBodyInit | undefined } {
  const url = `${base}/_oke/${key}`;
  if (input === undefined) return { url, method: "POST", body: undefined };
  if (isRawBody(input)) return { url, method: "POST", body: input };
  return { url, method: "POST", body: JSON.stringify(input ?? {}) };
}

function restRequest(
  base: string,
  method: string,
  path: string,
  input: unknown,
): { url: string; method: string; body: ClientBodyInit | undefined } {
  if (isRawBody(input)) {
    return { url: `${base}${path}`, method: method.toUpperCase(), body: input };
  }
  const interpolated = interpolatePath(path, input);
  const pathOut = interpolated.path;
  const rest = interpolated.rest;

  const upper = method.toUpperCase();
  const hasRest = Object.keys(rest).length > 0;
  let body: ClientBodyInit | undefined;
  let qs = "";
  if (upper === "GET" || upper === "HEAD") {
    qs = toQuery(rest);
  } else if (upper === "QUERY") {
    // RFC 10008 QUERY always carries JSON content (empty object when only path params).
    body = JSON.stringify(hasRest ? rest : {});
  } else if (hasRest || path === pathOut) {
    body = JSON.stringify(hasRest ? rest : (input ?? {}));
  }

  return { url: `${base}${pathOut}${qs}`, method: upper, body };
}

function isRawBody(input: unknown): input is ClientBodyInit {
  if (input instanceof Blob) return true;
  if (input instanceof FormData) return true;
  if (input instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(input)) return true;
  if (input instanceof ReadableStream) return true;
  return false;
}

async function decode(res: Response): Promise<ClientEnvelope> {
  if (res.status === 204) {
    return { data: undefined, error: null };
  }

  const text = await res.text();
  if (!text) {
    if (res.ok) return { data: undefined, error: null };
    return transportEnvelope(`HTTP ${res.status}`, res.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return transportEnvelope(`Invalid JSON (${res.status})`, res.status);
  }

  if (json !== null && typeof json === "object" && "data" in json && "error" in json) {
    return json as ClientEnvelope;
  }

  if (res.ok) {
    return { data: json, error: null };
  }

  return transportEnvelope(`HTTP ${res.status}`, res.status);
}

async function decodeBinary(res: Response, mode: "blob" | "arrayBuffer"): Promise<ClientEnvelope> {
  if (!res.ok) {
    const structured = await decodeIfEnvelope(res);
    if (structured) return structured;
    return transportEnvelope(`HTTP ${res.status}`, res.status);
  }
  const data = mode === "blob" ? await res.blob() : await res.arrayBuffer();
  return { data, error: null };
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
