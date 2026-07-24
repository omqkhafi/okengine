/**
 * Web-standard runtime adapter — fetch-handler path for Node / Deno / edge.
 *
 * Does not open a socket. {@link Runtime.serve} returns a {@link ServerHandle}
 * whose `fetch` is the secured pipeline; hosts wire it as:
 *
 * ```ts
 * const handle = createWebStandardRuntime().serve(app);
 * export default { fetch: handle.fetch }; // edge
 * Deno.serve(handle.fetch);
 * ```
 *
 * Host / Origin validation is identical to the Bun adapter (console §10.1).
 */

import {
  createEnv,
  createFiles,
  createTimers,
  createWebCrypto,
} from "./primitives.ts";
import { secureFetch } from "./security.ts";
import {
  APP_PORT,
  type FetchApp,
  type Runtime,
  type ServeOptions,
  type ServerHandle,
} from "./types.ts";

/**
 * Create the web-standard (Node / Deno / edge) runtime adapter.
 */
export function createWebStandardRuntime(): Runtime {
  return {
    name: "web-standard",
    timers: createTimers(),
    crypto: createWebCrypto(),
    env: createEnv(),
    files: createFiles(),
    serve(app, options) {
      return createFetchHandle(app, options);
    },
  };
}

/**
 * Build a secured fetch handle without listening.
 *
 * @param app - Application
 * @param options - Port/hostname metadata + `allowedHosts`
 */
function createFetchHandle(
  app: FetchApp,
  options?: ServeOptions,
): ServerHandle {
  const port = options?.port ?? APP_PORT;
  const hostname = options?.hostname ?? "127.0.0.1";
  const fetchHandler = secureFetch(
    (req) => app.fetch(req),
    options,
    hostname,
  );
  const url = new URL(
    `http://${hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}:${port}/`,
  );

  return {
    url,
    port,
    hostname,
    fetch: fetchHandler,
    stop() {
      // No socket — nothing to close.
    },
  };
}
