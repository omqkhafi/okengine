/**
 * Shared REST wire helpers for transport, live subscribe, and streams.
 */

import type { ClientHeaders, ClientOptions, ClientRouteMap, FlowContract } from "./types.ts";

/**
 * Visit every flow contract in `app.$routes`.
 *
 * @param $routes - Runtime route map
 * @param visit - Called with unit, flow, and contract
 */
export function walkContracts(
  $routes: ClientRouteMap | undefined,
  visit: (unit: string, flow: string, contract: FlowContract) => void,
): void {
  if (!$routes) return;
  for (const [unit, flows] of Object.entries($routes)) {
    if (!flows || typeof flows !== "object") continue;
    for (const [flow, contract] of Object.entries(flows)) {
      if (!contract || typeof contract !== "object") continue;
      visit(unit, flow, contract);
    }
  }
}

/**
 * Read `method` and `path` when both are strings.
 *
 * @param contract - One flow contract
 */
export function methodAndPath(
  contract: object,
): { readonly method: string; readonly path: string } | undefined {
  const method = "method" in contract ? contract.method : undefined;
  const path = "path" in contract ? contract.path : undefined;
  if (typeof method === "string" && typeof path === "string") return { method, path };
  return undefined;
}

/**
 * Replace `:param` tokens in `path`. Unmatched keys land in `rest`.
 *
 * @param path - Path template
 * @param input - JSON object, or anything else (ignored)
 */
export function interpolatePath(
  path: string,
  input: unknown,
): { readonly path: string; readonly rest: Record<string, unknown> } {
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
  return { path: pathOut, rest };
}

/**
 * Encode a query string, skipping `undefined` values.
 *
 * @param rest - Keys that were not path params
 */
export function toQuery(rest: Record<string, unknown>): string {
  const query: string[] = [];
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) {
      query.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return query.length > 0 ? `?${query.join("&")}` : "";
}

/**
 * Copy a header bag onto `headers` (later keys win within the bag).
 *
 * @param headers - Target
 * @param extra - Record or tuple list
 */
export function applyHeaderBag(headers: Headers, extra: ClientHeaders | undefined): void {
  if (!extra) return;
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) headers.set(k, v);
  } else {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
}

/**
 * Resolve `opts.headers` when it is a function.
 *
 * @param opts - Client options
 */
export async function resolveHeaders(opts: ClientOptions): Promise<ClientHeaders | undefined> {
  return typeof opts.headers === "function" ? await opts.headers() : opts.headers;
}

/**
 * Set `Authorization` from `opts.auth.getToken` when the caller did not.
 *
 * @param headers - Target
 * @param opts - Client options
 */
export async function applyAuthHeader(headers: Headers, opts: ClientOptions): Promise<void> {
  const token =
    opts.auth && "getToken" in opts.auth && typeof opts.auth.getToken === "function"
      ? await opts.auth.getToken()
      : undefined;
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
}
