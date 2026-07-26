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
    readonly resolveFlow?: (
      request: Request,
      response: Response,
    ) => string | undefined;
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
  logDevRequest({
    surface: options.surface ?? currentDevSurface(),
    method,
    path: url.pathname,
    flow: options.resolveFlow?.(request, response),
    status: response.status,
    ms: Math.round(performance.now() - started),
  });
  return response;
}
