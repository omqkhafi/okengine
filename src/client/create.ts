/**
 * `createClient<App>(url, opts)` — typed client, zero runtime codegen.
 *
 * Modes:
 * 1. Same-repo: `createClient<App>(url)` with `typeof app` after
 *    `.adopt({ notes })`, or `createClient(app, url)` to also wire REST from
 *    `app.$routes` at runtime
 * 2. Local dev: `createClient(url)` — types from ambient {@link Register}
 * 3. Separate repo: same as (2) after `oke client add <url>`
 *
 * Wire: HTTP triggers use REST (`method` + `path` from the bound trigger).
 * Untriggered flows fall back to `POST /_oke/{unit}/{flow}` RPC.
 */

import { createTransport, type Transport } from "./transport.ts";
import { asThenableIterable, attachPager } from "./pager.ts";
import type { Client, ClientOptions, ClientRouteMap, ResolveApp } from "./types.ts";

/** App-shaped value that carries a runtime `$routes` table from typed adopt. */
export interface AppWithRoutes {
  readonly $routes: ClientRouteMap;
}

/**
 * Create a fully typed client from an adopted app value (types + REST).
 *
 * @typeParam App - `typeof app` after `.adopt({ notes })`
 * @param app - Application instance with `$routes`
 * @param url - App base URL (port 6530 in dev)
 * @param opts - Transport options (retry, timeout, auth)
 */
export function createClient<App extends AppWithRoutes>(
  app: App,
  url: string,
  opts?: ClientOptions,
): Client<App>;

/**
 * Create a fully typed client from an App type argument / ambient Register.
 *
 * Pass `opts.$routes` (usually `app.$routes`) so HTTP triggers issue REST
 * instead of RPC.
 *
 * @typeParam App - `typeof app`, {@link AppOf} route map, or omit for {@link Register}
 * @param url - App base URL (port 6530 in dev)
 * @param opts - Transport options (retry, timeout, auth, `$routes`)
 */
export function createClient<App = never>(
  url: string,
  opts?: ClientOptions,
): Client<ResolveApp<App>>;

/**
 * @param appOrUrl - App instance or base URL
 * @param urlOrOpts - Base URL (when app given) or options
 * @param maybeOpts - Options when app + url form is used
 */
export function createClient(
  appOrUrl: AppWithRoutes | string,
  urlOrOpts?: string | ClientOptions,
  maybeOpts?: ClientOptions,
): Client {
  if (typeof appOrUrl === "string") {
    return buildClient(appOrUrl, urlOrOpts as ClientOptions | undefined);
  }
  const url = typeof urlOrOpts === "string" ? urlOrOpts : "";
  const opts = typeof urlOrOpts === "string" ? maybeOpts : urlOrOpts;
  return buildClient(url, {
    ...opts,
    $routes: opts?.$routes ?? appOrUrl.$routes,
  });
}

/**
 * Shared constructor — flattens `$routes` into the transport REST table.
 *
 * @param url - Base URL
 * @param opts - Client options
 */
function buildClient(url: string, opts: ClientOptions = {}): Client {
  const base = url.replace(/\/+$/, "");
  const routes = opts.routes ?? flattenRoutes(opts.$routes);
  const transport = createTransport(base, { ...opts, routes });
  return proxy(transport, []) as Client;
}

/**
 * Flatten `app.$routes` into the transport REST table (`unit.flow` → method/path).
 * Entries without both method and path are omitted (RPC fallback).
 *
 * @param $routes - Runtime route map from typed adopt
 */
export function flattenRoutes(
  $routes: ClientRouteMap | undefined,
): ClientOptions["routes"] | undefined {
  if (!$routes) return undefined;
  const out: Record<string, { readonly method: string; readonly path: string }> = {};
  for (const [unit, flows] of Object.entries($routes)) {
    if (!flows || typeof flows !== "object") continue;
    for (const [flow, contract] of Object.entries(flows)) {
      if (!contract || typeof contract !== "object") continue;
      const method = "method" in contract ? contract.method : undefined;
      const path = "path" in contract ? contract.path : undefined;
      if (typeof method === "string" && typeof path === "string") {
        out[`${unit}.${flow}`] = { method, path };
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a nested Proxy: `api.notes.get(input)` → REST or RPC from routes.
 *
 * @param transport - HTTP transport
 * @param path - Accumulated property path
 */
function proxy(transport: Transport, path: readonly string[]): unknown {
  const invoke = async (input?: unknown) => {
    if (path.length < 2) {
      return attachPager(
        {
          data: null,
          error: {
            code: "TransportError" as const,
            data: {
              message: `Incomplete path: api.${path.join(".") || "?"}(…)`,
            },
          },
        },
        invoke,
        input,
      );
    }
    const unit = path[0]!;
    const flow = path.slice(1).join(".");
    const result = await transport.call(`${unit}/${flow}`, input);
    return attachPager(result, invoke, input);
  };
  const call = (input?: unknown) => asThenableIterable(invoke, input);

  return new Proxy(call, {
    get(_target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(_target, prop, receiver);
      }
      if (prop === "then") return undefined;
      return proxy(transport, [...path, prop]);
    },
  });
}
