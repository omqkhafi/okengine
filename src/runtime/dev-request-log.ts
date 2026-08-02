/**
 * Dev-only request lines for `oke dev` (App / Console / MCP).
 *
 * Gated by `OKE_DEV_REQUEST_LOG=1`. Surfaces share one TTY; label + color
 * keep streams readable without a multiplexer.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { formatRequestLine, type DevLogSurface } from "../term.ts";

const surfaceAls = new AsyncLocalStorage<DevLogSurface>();

/**
 * Whether colored request lines should print.
 */
export function shouldLogDevRequests(): boolean {
  return process.env.OKE_DEV_REQUEST_LOG === "1";
}

/**
 * Active surface for this async context, or `OKE_DEV_SURFACE`, or `App`.
 */
export function currentDevSurface(): DevLogSurface {
  const fromAls = surfaceAls.getStore();
  if (fromAls) return fromAls;
  const fromEnv = process.env.OKE_DEV_SURFACE;
  if (fromEnv === "App" || fromEnv === "Console" || fromEnv === "MCP") {
    return fromEnv;
  }
  return "App";
}

/**
 * Run a handler tagged with a surface (Console wrap around `app.fetch`).
 *
 * @param surface - App · Console · MCP
 * @param fn - Async work
 */
export function runWithDevSurface<T>(
  surface: DevLogSurface,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return surfaceAls.run(surface, fn);
}

/** Fields for one request line. */
export type DevRequestLogInput = {
  readonly surface?: DevLogSurface;
  readonly method: string;
  readonly path: string;
  /** Flow name, RPC method, or tool id. */
  readonly flow?: string;
  readonly status: number;
  readonly ms: number;
  /** Human failure detail (error.message / code) for 4xx/5xx. */
  readonly detail?: string;
};

/**
 * Paths that would drown the TTY (live WS, health probes, static assets).
 *
 * @param method - HTTP method
 * @param path - URL pathname
 */
export function isSilentDevRequest(method: string, path: string): boolean {
  if (path === "/console/live") return true;
  // Client-types regen — lands between hero and Logs and breaks the separator.
  if (path === "/_oke/client.json") return true;
  if (method === "GET" && (path === "/health" || path.endsWith("/health"))) {
    return true;
  }
  return /\.(?:js|css|map|svg|png|ico|woff2?|ttf|webp)$/i.test(path);
}

/**
 * Extract a short failure detail from an OKE JSON envelope body.
 *
 * @param response - HTTP response (cloned; original body stays readable)
 */
export async function failureDetailFromResponse(response: Response): Promise<string | undefined> {
  if (response.status < 400) return undefined;
  try {
    const body: unknown = await response.clone().json();
    if (body === null || typeof body !== "object" || !("error" in body)) return undefined;
    const error = (body as { error: unknown }).error;
    if (error === null || typeof error !== "object") return undefined;
    const rec = error as { message?: unknown; code?: unknown; data?: unknown };
    if (typeof rec.message === "string" && rec.message.trim().length > 0) {
      return rec.message.trim();
    }
    if (
      rec.data !== null &&
      typeof rec.data === "object" &&
      "reason" in rec.data &&
      typeof (rec.data as { reason: unknown }).reason === "string"
    ) {
      const reason = (rec.data as { reason: string }).reason;
      const code = typeof rec.code === "string" ? rec.code : "Error";
      return `${code}: ${reason}`;
    }
    if (typeof rec.code === "string") return rec.code;
  } catch {
    // non-JSON error bodies stay status-only
  }
  return undefined;
}

/**
 * Print one request line when {@link shouldLogDevRequests} is on.
 *
 * @param input - Request summary
 */
export function logDevRequest(input: DevRequestLogInput): void {
  if (!shouldLogDevRequests()) return;
  if (isSilentDevRequest(input.method.toUpperCase(), input.path)) return;
  process.stdout.write(
    formatRequestLine({
      surface: input.surface ?? currentDevSurface(),
      method: input.method,
      path: input.path,
      flow: input.flow,
      status: input.status,
      ms: input.ms,
      detail: input.detail,
    }),
  );
}

/**
 * Time an async fetch handler and log the outcome.
 *
 * @param surface - Fixed surface (MCP) or omit to use ALS/env
 * @param request - Incoming request
 * @param handle - Inner fetch
 * @param resolveFlow - Optional label after the response (e.g. RPC method)
 */
export async function timedDevFetch(
  request: Request,
  handle: (request: Request) => Response | Promise<Response>,
  options: {
    readonly surface?: DevLogSurface;
    readonly resolveFlow?: (request: Request, response: Response) => string | undefined;
    /** Skip logging for this path/method. */
    readonly silent?: (request: Request) => boolean;
  } = {},
): Promise<Response> {
  if (!shouldLogDevRequests() || options.silent?.(request)) {
    return handle(request);
  }
  const started = performance.now();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const response = await handle(request);
  const detail = await failureDetailFromResponse(response);
  logDevRequest({
    surface: options.surface ?? currentDevSurface(),
    method,
    path: url.pathname,
    flow: options.resolveFlow?.(request, response),
    status: response.status,
    ms: Math.round(performance.now() - started),
    detail,
  });
  return response;
}
