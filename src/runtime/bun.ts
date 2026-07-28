/**
 * Bun runtime adapter — `Bun.serve`, `bun:sqlite`, `Bun.password`.
 *
 * Uses Bun native `routes` for HTTP paths the engine can express, with
 * `fetch` as the fallback. Every request passes Host / Origin validation
 * before the app pipeline (console §10.1).
 */

import { Database } from "bun:sqlite";
import { createBunCrypto, createEnv, createFiles, createTimers } from "./primitives.ts";
import { secureFetch } from "./security.ts";
import {
  APP_PORT,
  type FetchApp,
  type Runtime,
  type ServeOptions,
  type ServerHandle,
} from "./types.ts";

/** Bun adapter — extends {@link Runtime} with native sqlite. */
export interface BunRuntime extends Runtime {
  readonly name: "bun";
  /**
   * Open a `bun:sqlite` database (native binding).
   *
   * @param filename - Path, `":memory:"`, or omit for memory
   * @param options - `bun:sqlite` open options
   */
  sqlite(filename?: string, options?: ConstructorParameters<typeof Database>[1]): Database;
}

/**
 * Create the Bun runtime adapter.
 */
export function createBunRuntime(): BunRuntime {
  return {
    name: "bun",
    timers: createTimers(),
    crypto: createBunCrypto(),
    env: createEnv(),
    files: createFiles(),
    sqlite(filename = ":memory:", options) {
      return options === undefined ? new Database(filename) : new Database(filename, options);
    },
    serve(app, options) {
      return listenBun(app, options);
    },
  };
}

/**
 * True when a path can be registered on Bun.serve `routes`
 * (static segments and `:param` only).
 *
 * @param path - Route path pattern
 */
export function isBunNativePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // Reject optional params, regex, wildcards Bun's object routes may not mirror 1:1
  if (/[*?{}()]/.test(path)) return false;
  if (/\/:[^/]+\?/.test(path)) return false;
  return true;
}

type MethodHandlers = Partial<Record<string, (req: Request) => Response | Promise<Response>>>;

/**
 * Build Bun.serve `routes` from app HTTP bindings.
 * Each handler runs the secured fetch pipeline (identical behaviour).
 *
 * @param app - Application
 * @param fetchHandler - Secured fetch
 */
export function buildBunRoutes(
  app: FetchApp,
  fetchHandler: (request: Request) => Promise<Response>,
): Record<string, MethodHandlers> {
  const routes: Record<string, MethodHandlers> = {};
  const bindings = app.bindings ?? [];
  for (const b of bindings) {
    if (b.trigger.kind !== "http") continue;
    const path = b.trigger.path;
    const method = b.trigger.method;
    if (typeof path !== "string" || typeof method !== "string") continue;
    if (!isBunNativePath(path)) continue;
    const methods = routes[path] ?? (routes[path] = {});
    methods[method] = (req) => fetchHandler(req);
  }
  return routes;
}

function listenBun(app: FetchApp, options?: ServeOptions): ServerHandle {
  const port = options?.port ?? APP_PORT;
  const hostname = options?.hostname ?? "127.0.0.1";
  const fetchHandler = secureFetch((req) => app.fetch(req), options, hostname);
  const routes = buildBunRoutes(app, fetchHandler);

  const server = Bun.serve({
    port,
    hostname,
    ...(options?.id !== undefined ? { id: options.id } : {}),
    routes: Object.keys(routes).length > 0 ? routes : undefined,
    fetch: fetchHandler,
  });

  const boundPort = server.port ?? port;
  const boundHost = server.hostname ?? hostname;
  const url = new URL(`http://${formatHostForUrl(boundHost)}:${boundPort}/`);

  return {
    url,
    port: boundPort,
    hostname: boundHost,
    fetch: fetchHandler,
    stop(closeActiveConnections = false) {
      server.stop(closeActiveConnections);
    },
  };
}

/**
 * Format a hostname for use in a URL (bracket IPv6).
 *
 * @param host - Hostname
 */
function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}
