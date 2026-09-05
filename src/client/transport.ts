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
            return {
              data: null,
              error: {
                code: "TransportError",
                data: {
                  message: err instanceof Error ? err.message : String(err),
                },
              },
            };
          }
          await sleep(delay);
          delay *= backoff;
          attempt += 1;
        }
      }
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
  const extra = typeof opts.headers === "function" ? await opts.headers() : opts.headers;
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) headers.set(k, v);
  } else if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  if (Array.isArray(callHeaders)) {
    for (const [k, v] of callHeaders) headers.set(k, v);
  } else if (callHeaders) {
    for (const [k, v] of Object.entries(callHeaders)) headers.set(k, v);
  }
  if (body !== undefined && !headers.has("content-type") && typeof body === "string") {
    headers.set("content-type", "application/json");
  }

  const token =
    opts.auth && "getToken" in opts.auth && typeof opts.auth.getToken === "function"
      ? await opts.auth.getToken()
      : undefined;
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const signals: AbortSignal[] = [];
  if (opts.signal) signals.push(opts.signal);
  if (opts.timeout !== undefined) {
    const t = AbortSignal.timeout(opts.timeout);
    signals.push(t);
  }
  const signal =
    signals.length === 0
      ? undefined
      : signals.length === 1
        ? signals[0]
        : AbortSignal.any(signals);

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
  const params =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  let pathOut = path;
  const query: string[] = [];
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
  let body: ClientBodyInit | undefined;
  if (upper === "GET" || upper === "HEAD") {
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) {
        query.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
  } else if (upper === "QUERY") {
    // RFC 10008 QUERY always carries JSON content (empty object when only path params).
    body = JSON.stringify(Object.keys(rest).length > 0 ? rest : {});
  } else if (Object.keys(rest).length > 0 || path === pathOut) {
    body = JSON.stringify(Object.keys(rest).length > 0 ? rest : (input ?? {}));
  }

  const qs = query.length ? `?${query.join("&")}` : "";
  return { url: `${base}${pathOut}${qs}`, method: upper, body };
}

function isRawBody(input: unknown): input is ClientBodyInit {
  if (input === null || input === undefined) return false;
  if (typeof Blob !== "undefined" && input instanceof Blob) return true;
  if (typeof FormData !== "undefined" && input instanceof FormData) return true;
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) return true;
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(input)) return true;
  if (typeof ReadableStream !== "undefined" && input instanceof ReadableStream) return true;
  return false;
}

async function decode(res: Response): Promise<ClientEnvelope> {
  if (res.status === 204) {
    return { data: undefined, error: null };
  }

  const text = await res.text();
  if (!text) {
    if (res.ok) return { data: undefined, error: null };
    return {
      data: null,
      error: {
        code: "TransportError",
        data: { message: `HTTP ${res.status}`, status: res.status },
      },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      data: null,
      error: {
        code: "TransportError",
        data: {
          message: `Invalid JSON (${res.status})`,
          status: res.status,
        },
      },
    };
  }

  if (json !== null && typeof json === "object" && "data" in json && "error" in json) {
    return json as ClientEnvelope;
  }

  if (res.ok) {
    return { data: json, error: null };
  }

  return {
    data: null,
    error: {
      code: "TransportError",
      data: { message: `HTTP ${res.status}`, status: res.status },
    },
  };
}

async function decodeBinary(
  res: Response,
  mode: "blob" | "arrayBuffer",
): Promise<ClientEnvelope> {
  if (!res.ok) {
    const structured = await decodeIfEnvelopeClone(res);
    if (structured) return structured;
    return {
      data: null,
      error: {
        code: "TransportError",
        data: { message: `HTTP ${res.status}`, status: res.status },
      },
    };
  }
  const data = mode === "blob" ? await res.blob() : await res.arrayBuffer();
  return { data, error: null };
}

/** Try JSON envelope from an error response without assuming the body is reusable. */
async function decodeIfEnvelopeClone(res: Response): Promise<ClientEnvelope | null> {
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

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
