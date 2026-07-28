/**
 * Serve the Console on port 6533 — SPA + operator flows + live channel.
 *
 * Host/Origin validation is mandatory (console §10.1). Security headers and
 * SameSite=Strict cookies are applied from the first response.
 */

import {
  checkRequestSecurity,
  forbiddenResponse,
  resolveAllowedHosts,
  secureFetch,
} from "../../runtime/security.ts";
import { runWithDevSurface } from "../../runtime/dev-request-log.ts";
import { CONSOLE_PORT, type ServerHandle } from "../../runtime/types.ts";
import {
  bindManifestSignalBus,
  bindManifestStoreRuntime,
  bindManifestVaultRuntime,
  bootConsoleApp,
  createConsoleApp,
  type ConsoleAppHandle,
  type CreateConsoleAppOptions,
} from "./app.ts";
import { createLiveWebsocket, type ConsoleLiveData } from "./live.ts";
import { openConsolePersistence } from "./operator-db.ts";
import {
  CONSOLE_COOKIES,
  consoleSessionCookie,
  withConsoleSecurityHeaders,
} from "./security-headers.ts";

/** Options for {@link serveConsole}. */
export interface ServeConsoleOptions extends CreateConsoleAppOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly allowedHosts?: readonly string[];
  /** Directory of prebuilt SPA assets (Vite outDir). */
  readonly staticDir?: string;
  /** Boot environment — use `"dev"` / `"prod"` so Bearer auth is production-like. */
  readonly env?: "dev" | "prod" | "test";
  /**
   * Persist operators + secret under `.oke/` (default true).
   * Set false for ephemeral test servers.
   */
  readonly persist?: boolean;
}

/** Running Console server handle. */
export interface ConsoleServerHandle extends ServerHandle {
  readonly console: ConsoleAppHandle;
}

/**
 * Boot and serve the Console kernel.
 *
 * @param options - Port, static dir, claim options
 */
export async function serveConsole(
  options: ServeConsoleOptions = {},
): Promise<ConsoleServerHandle> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? CONSOLE_PORT;
  const cwd = options.cwd ?? process.cwd();
  const wantPersist = options.persist !== false && options.operators === undefined;
  const persistence = wantPersist
    ? await openConsolePersistence(cwd, {
        envSecret: options.secret ?? process.env.OKE_CONSOLE_SECRET,
      })
    : null;
  const handle = createConsoleApp({
    ...options,
    cwd,
    silentClaim: options.silentClaim ?? false,
    ...(persistence
      ? {
          secret: options.secret ?? persistence.secret,
          operators: persistence.operators,
          sessions: persistence.sessions,
          persistOperator: persistence.persistOperator,
          persistSessions: persistence.persistSessions,
        }
      : {}),
  });

  // Console serve `"dev"` is the auth/session flavor — ConfigEnv uses `local`.
  const env = options.env ?? "dev";
  await handle.app.boot({ env: env === "dev" ? "local" : env });
  handle.state.listRuns = async () => {
    const runs = handle.app.bootResult?.runs;
    if (!runs) return [];
    return runs.all();
  };
  await bindManifestSignalBus(handle.state);
  await bindManifestStoreRuntime(handle.state);
  await bindManifestVaultRuntime(handle.state);

  const staticDir = options.staticDir ?? new URL("../ui/dist/", import.meta.url).pathname;

  const live = createLiveWebsocket(handle.state);
  const allowed = resolveAllowedHosts(hostname, options.allowedHosts);

  const appFetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/console/live") {
      return withConsoleSecurityHeaders(
        new Response("Expected WebSocket upgrade", { status: 426 }),
      );
    }

    const authed = withCookieAuth(request);

    if (url.pathname.startsWith("/console/")) {
      const response = await runWithDevSurface("Console", () => handle.app.fetch(authed));
      const withCookies = await attachSessionCookies(authed, response);
      return withConsoleSecurityHeaders(withCookies);
    }

    if (url.pathname.startsWith("/plugin-frame/")) {
      return withConsoleSecurityHeaders(pluginFrameResponse(url.pathname));
    }

    const staticResponse = await serveStatic(staticDir, url.pathname);
    if (staticResponse) {
      return withConsoleSecurityHeaders(staticResponse);
    }

    const index = Bun.file(`${staticDir}index.html`);
    if (await index.exists()) {
      return withConsoleSecurityHeaders(
        new Response(index, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    }

    return withConsoleSecurityHeaders(
      new Response(fallbackShellHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
  };

  const fetchHandler = secureFetch(appFetch, options, hostname);

  const server = Bun.serve<ConsoleLiveData>({
    port,
    hostname,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/console/live") {
        const check = checkRequestSecurity(req, allowed);
        if (!check.ok) return forbiddenResponse(check.reason);
        const upgraded = srv.upgrade(req, { data: { kind: "console-live" } });
        if (upgraded) return undefined as unknown as Response;
        return withConsoleSecurityHeaders(
          new Response("WebSocket upgrade failed", { status: 400 }),
        );
      }
      return fetchHandler(req);
    },
    websocket: {
      open: live.open,
      message: live.message,
      close: live.close,
    },
  });

  const boundPort = server.port ?? port;
  const boundHost = server.hostname ?? hostname;
  const hostForUrl =
    boundHost.includes(":") && !boundHost.startsWith("[") ? `[${boundHost}]` : boundHost;
  const url = new URL(`http://${hostForUrl}:${boundPort}/`);

  return {
    console: handle,
    url,
    port: boundPort,
    hostname: boundHost,
    fetch: fetchHandler,
    stop(closeActive = false) {
      server.stop(closeActive);
      void handle.app.stop();
      persistence?.close();
    },
  };
}

/**
 * Create + boot without listening (unit tests).
 *
 * @param options - Console options
 */
export async function startConsoleApp(
  options: CreateConsoleAppOptions & {
    readonly env?: "dev" | "prod" | "test";
    /** Opt-in durable operators under `.oke/` (default false for unit tests). */
    readonly persist?: boolean;
  } = {},
): Promise<ConsoleAppHandle> {
  const cwd = options.cwd ?? process.cwd();
  const persistence =
    options.persist === true && options.operators === undefined
      ? await openConsolePersistence(cwd, {
          envSecret: options.secret ?? process.env.OKE_CONSOLE_SECRET,
        })
      : null;
  const handle = createConsoleApp({
    ...options,
    cwd,
    silentClaim: options.silentClaim ?? true,
    ...(persistence
      ? {
          secret: options.secret ?? persistence.secret,
          operators: persistence.operators,
          sessions: persistence.sessions,
          persistOperator: persistence.persistOperator,
          persistSessions: persistence.persistSessions,
        }
      : {}),
  });
  await bootConsoleApp(handle);
  return handle;
}

/**
 * Promote session cookie → Authorization when Bearer is absent.
 *
 * @param request - Incoming request
 */
export function withCookieAuth(request: Request): Request {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) {
    return request;
  }
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${CONSOLE_COOKIES.access}=([^;]+)`));
  if (!match?.[1]) return request;
  const token = decodeURIComponent(match[1]);
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

/**
 * After successful claim/login, mirror tokens into SameSite=Strict cookies.
 *
 * @param request - Request
 * @param response - Flow response
 */
export async function attachSessionCookies(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status >= 400) return response;
  const url = new URL(request.url);
  const isSessionIssue =
    url.pathname === "/console/setup/claim" || url.pathname === "/console/session/login";
  const isLogout = url.pathname === "/console/session/logout";
  if (!isSessionIssue && !isLogout) return response;

  let body: {
    data?: { accessToken?: string; refreshToken?: string };
  };
  try {
    body = (await response.clone().json()) as typeof body;
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  if (isLogout) {
    headers.append("Set-Cookie", consoleSessionCookie(CONSOLE_COOKIES.access, "", { clear: true }));
    headers.append(
      "Set-Cookie",
      consoleSessionCookie(CONSOLE_COOKIES.refresh, "", { clear: true }),
    );
  } else if (body.data?.accessToken && body.data?.refreshToken) {
    headers.append(
      "Set-Cookie",
      consoleSessionCookie(CONSOLE_COOKIES.access, body.data.accessToken, {
        maxAgeSec: 14 * 60,
      }),
    );
    headers.append(
      "Set-Cookie",
      consoleSessionCookie(CONSOLE_COOKIES.refresh, body.data.refreshToken, {
        maxAgeSec: 30 * 24 * 60 * 60,
      }),
    );
  }
  return new Response(JSON.stringify(body), {
    status: response.status,
    headers,
  });
}

async function serveStatic(staticDir: string, pathname: string): Promise<Response | null> {
  if (pathname.includes("..")) return null;
  const path = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const file = Bun.file(`${staticDir}${path}`);
  if (!(await file.exists())) return null;
  return new Response(file);
}

function pluginFrameResponse(pathname: string): Response {
  const id = pathname.slice("/plugin-frame/".length).replace(/[^a-z0-9_-]/gi, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"/>
<title>Plugin ${id}</title>
</head>
<body>
<script type="module">
const id = ${JSON.stringify(id)};
window.parent.postMessage({ type: "oke-plugin-ready", id }, location.origin);
window.addEventListener("message", (ev) => {
  if (ev.origin !== location.origin) return;
  if (ev.data?.type === "oke-plugin-rpc") {
    window.parent.postMessage({ type: "oke-plugin-rpc-result", id, ok: false, error: "sandbox" }, location.origin);
  }
});
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function fallbackShellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>oke Console</title>
</head>
<body>
<div id="root">
  <main>
    <h1>oke Console</h1>
    <p>Shell assets not built — run the Console UI build, or use the API on <code>/console/*</code>.</p>
  </main>
</div>
</body>
</html>`;
}
