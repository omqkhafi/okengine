/**
 * `createClient<App>(url, opts)` — typed client, zero runtime codegen.
 *
 * Modes:
 * 1. Same-repo: `createClient<App>(url)` with `import type { App }`
 * 2. Local dev: `createClient(url)` — types from ambient {@link Register}
 * 3. Separate repo: same as (2) after `oke client add <url>`
 */

import { createTransport, type Transport } from "./transport.ts";
import type {
  Client,
  ClientOptions,
  ResolveApp,
} from "./types.ts";

/**
 * Create a fully typed client for an OKE app.
 *
 * @typeParam App - `typeof app`, {@link AppOf} route map, or omit for {@link Register}
 * @param url - App base URL (port 6530 in dev)
 * @param opts - Transport options (retry, timeout, auth)
 */
export function createClient<App = never>(
  url: string,
  opts: ClientOptions = {},
): Client<ResolveApp<App>> {
  const base = url.replace(/\/+$/, "");
  const transport = createTransport(base, opts);
  return proxy(transport, []) as Client<ResolveApp<App>>;
}

/**
 * Build a nested Proxy: `api.notes.get(input)` → transport `notes/get`.
 *
 * @param transport - HTTP transport
 * @param path - Accumulated property path
 */
function proxy(transport: Transport, path: readonly string[]): unknown {
  const call = (input?: unknown) => {
    if (path.length < 2) {
      return Promise.resolve({
        data: null,
        error: {
          code: "TransportError" as const,
          data: {
            message: `Incomplete path: api.${path.join(".") || "?"}(…)`,
          },
        },
      });
    }
    // `api.bookings.create` → unit `bookings`, flow `create`
    const unit = path[0]!;
    const flow = path.slice(1).join(".");
    return transport.call(`${unit}/${flow}`, input);
  };

  return new Proxy(call, {
    get(_target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(_target, prop, receiver);
      }
      // Prevent `await api.notes` from treating the proxy as a Thenable.
      if (prop === "then") return undefined;
      return proxy(transport, [...path, prop]);
    },
  });
}
