/**
 * Incremental adoption — mount an OKE app into an existing host framework.
 *
 * Direction (investigated): host → OKE is the higher-value on-ramp. An
 * existing Hono/Express investment mounts one OKE fetch pipeline without
 * abandoning its routes. Spec §23 shows the inverse polarity
 * (`mount(honoApp)` = legacy inside OKE); that path is not shipped here.
 *
 * Shipped bridges:
 * - **Hono** — zero conversion; pass {@link MountHandle.fetch} to
 *   `honoApp.mount(path, handle.fetch)`.
 * - **Express** — thin Node req/res ↔ Web Request/Response adapter via
 *   {@link MountHandle.asExpress}.
 *
 * Not shipped (awkward): Fastify-native and Nest-specific adapters.
 * Nest-on-Express can reuse {@link MountHandle.asExpress} on the underlying
 * Express instance.
 */

import { createWebStandardRuntime } from "./web-standard.ts";
import type { FetchApp, ServeOptions } from "./types.ts";

/**
 * Options for {@link mount}.
 *
 * Extends serve options so Host / Origin checks remain available when the
 * mounted path is exposed without an outer framework security layer.
 */
export interface MountOptions extends ServeOptions {
  /**
   * When true, skip Host/Origin validation (host framework already checked).
   * Default false — mounted flows keep the same security wrap as
   * {@link createWebStandardRuntime}.
   */
  readonly trustHost?: boolean;
}

/**
 * Minimal Express-compatible request (duck-typed — no `express` import).
 */
export interface ExpressLikeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly originalUrl?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly httpVersion?: string;
  readonly readable?: boolean;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  once?(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * Minimal Express-compatible response (duck-typed).
 */
export interface ExpressLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): this | void;
  getHeader?(name: string): unknown;
  end(chunk?: unknown, encoding?: unknown, cb?: unknown): unknown;
  write(chunk: unknown, encoding?: unknown, cb?: unknown): unknown;
  headersSent?: boolean;
}

/** Next-function shape used by Express middleware. */
export type ExpressNext = (err?: unknown) => void;

/** Express middleware returned by {@link MountHandle.asExpress}. */
export type ExpressMiddleware = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressNext,
) => void | Promise<void>;

/**
 * Handle returned by {@link mount} — wire into a host without weakening
 * gates, capabilities, or effect tracking on OKE-matched routes.
 */
export interface MountHandle {
  /**
   * Web-standard fetch handler.
   *
   * Hono: `host.mount("/oke", handle.fetch)`.
   * Path rewriting is Hono's job; OKE sees the stripped pathname.
   *
   * @param request - Incoming Web Request
   */
  fetch(request: Request): Promise<Response>;
  /**
   * Express middleware wrapping the same fetch pipeline.
   *
   * Limitations (reported, not silently degraded):
   * - Response bodies are buffered (`arrayBuffer`) before `res.end` —
   *   long-lived streaming responses are not piped chunk-by-chunk.
   * - Hop-by-hop headers (`transfer-encoding`, `connection`, …) are omitted.
   * - Request body uses `Request` with `duplex: "half"` when a body is present.
   *
   * Gates / capabilities / effects are unchanged — middleware only bridges I/O.
   */
  asExpress(): ExpressMiddleware;
}

/**
 * Mount an OKE app for embedding inside an existing host.
 *
 * @param app - Booted (or bootable) OKE app with {@link FetchApp.fetch}
 * @param options - Host/Origin allow-list and trust flag
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { mount } from "okengine";
 *
 * await app.boot();
 * const host = new Hono();
 * host.mount("/oke", mount(app).fetch);
 * ```
 */
export function mount(app: FetchApp, options?: MountOptions): MountHandle {
  const fetchHandler = options?.trustHost
    ? (request: Request) => Promise.resolve(app.fetch(request))
    : createWebStandardRuntime().serve(app, options).fetch;

  return {
    fetch: fetchHandler,
    asExpress() {
      return createExpressMiddleware(fetchHandler);
    },
  };
}

/** Hop-by-hop headers that must not be copied onto Node responses. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/**
 * Build Express middleware around a fetch handler.
 *
 * @param fetchHandler - OKE (or secured) fetch pipeline
 */
export function createExpressMiddleware(
  fetchHandler: (request: Request) => Promise<Response>,
): ExpressMiddleware {
  return async (req, res, next) => {
    try {
      const request = await nodeRequestToWeb(req);
      const response = await fetchHandler(request);
      await webResponseToNode(response, res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convert a Node/Express request into a Web {@link Request}.
 *
 * Uses `req.url` (mount-stripped path) so OKE route paths stay absolute
 * from the app's perspective — matching Hono's default mount rewrite.
 *
 * @param req - Express-like request
 */
export async function nodeRequestToWeb(
  req: ExpressLikeRequest,
): Promise<Request> {
  const hostHeader = headerValue(req.headers, "host") ?? "127.0.0.1";
  const pathAndQuery = req.url && req.url.length > 0 ? req.url : "/";
  const url = new URL(pathAndQuery, `http://${hostHeader}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const href = url.href;
  if (!hasBody) {
    return new Request(href, { method, headers });
  }

  const body = await readNodeBody(req);
  return new Request(href, {
    method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
  });
}

/**
 * Write a Web {@link Response} onto a Node response.
 *
 * Buffers the body — see {@link MountHandle.asExpress} limitations.
 *
 * @param response - Web Response
 * @param res - Express-like response
 */
export async function webResponseToNode(
  response: Response,
  res: ExpressLikeResponse,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
  if (response.status === 204 || response.status === 304) {
    res.end();
    return;
  }
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

/**
 * Read a Node request body into a single buffer.
 *
 * @param req - Readable request
 */
async function readNodeBody(req: ExpressLikeRequest): Promise<Uint8Array> {
  if (typeof req[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
      }
    }
    return concatUint8(chunks);
  }

  return await new Promise<Uint8Array>((resolve, reject) => {
    if (typeof req.on !== "function") {
      resolve(new Uint8Array());
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on("end", () => resolve(concatUint8(chunks)));
    req.on("error", (err: unknown) => reject(err));
  });
}

/**
 * @param chunks - Body chunks
 */
function concatUint8(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * @param headers - Node header bag
 * @param name - Header name (case-insensitive)
 */
function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct === undefined) return undefined;
  return Array.isArray(direct) ? direct[0] : direct;
}
