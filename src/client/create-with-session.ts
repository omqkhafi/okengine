/**
 * `createClient` with optional session `auth` → `api.auth` ({@link AuthClient}).
 *
 * Bare transport stays in {@link ./create.ts} (budget entry). This wrapper is
 * what `okengine/client` exports.
 *
 * @module
 */

import {
  createAuthClient,
  type AuthApi,
  type AuthClient,
  type CreateAuthClientOptions,
} from "./auth/create-auth-client.ts";
import { tokenFromRequestCookies, type CookieSource } from "./auth/cookies.ts";
import {
  createClient as createClientCore,
  flattenRoutes,
  transportOf,
  type AppWithRoutes,
  type TransportBag,
} from "./create.ts";
import type {
  Client,
  ClientHeaders,
  ClientOptions,
  ClientSessionAuthOptions,
  ClientTransportAuth,
  ResolveApp,
} from "./types.ts";

export { flattenRoutes, transportOf };
export type { AppWithRoutes, TransportBag };

/** Session-option keys that distinguish orchestration from bare transport hooks. */
const SESSION_AUTH_KEYS = [
  "mode",
  "persist",
  "csrfConfigured",
  "storageKey",
  "session",
  "tenantHeader",
  "env",
] as const;

/**
 * True when `auth` is bare `{ getToken, refresh }` without session keys.
 *
 * @param auth - Client auth option
 */
export function isTransportAuthOnly(auth: unknown): auth is ClientTransportAuth {
  if (auth === null || typeof auth !== "object") return false;
  const bag = auth as Record<string, unknown>;
  const hasHooks =
    typeof bag.getToken === "function" && typeof bag.refresh === "function";
  if (!hasHooks) return false;
  for (const key of SESSION_AUTH_KEYS) {
    if (key in bag && bag[key] !== undefined) return false;
  }
  return true;
}

/**
 * True when `auth` should construct an {@link AuthClient} on the client.
 *
 * @param auth - Client auth option
 */
export function isSessionAuthOptions(auth: unknown): auth is ClientSessionAuthOptions {
  return auth !== null && typeof auth === "object" && !isTransportAuthOnly(auth);
}

/**
 * Create a fully typed client from an adopted app value (types + REST).
 *
 * @typeParam App - `typeof app` after `.adopt({ notes })`
 */
export function createClient<App extends AppWithRoutes>(
  app: App,
  url: string,
  opts?: ClientOptions,
): Client<App>;

/**
 * Create a fully typed client from an App type argument / ambient Register.
 *
 * @typeParam App - `typeof app`, {@link AppOf} route map, or omit for {@link Register}
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
  const { url, opts } = normalizeArgs(appOrUrl, urlOrOpts, maybeOpts);
  if (!opts?.auth || isTransportAuthOnly(opts.auth)) {
    return createClientCore(appOrUrl as never, urlOrOpts as never, maybeOpts as never);
  }
  return buildWithSession(url, opts);
}

function normalizeArgs(
  appOrUrl: AppWithRoutes | string,
  urlOrOpts?: string | ClientOptions,
  maybeOpts?: ClientOptions,
): { url: string; opts: ClientOptions } {
  if (typeof appOrUrl === "string") {
    return { url: appOrUrl, opts: (urlOrOpts as ClientOptions | undefined) ?? {} };
  }
  const url = typeof urlOrOpts === "string" ? urlOrOpts : "";
  const opts = (typeof urlOrOpts === "string" ? maybeOpts : urlOrOpts) ?? {};
  return {
    url,
    opts: { ...opts, $routes: opts.$routes ?? appOrUrl.$routes },
  };
}

function buildWithSession(url: string, opts: ClientOptions): Client {
  const sessionOpts = opts.auth as CreateAuthClientOptions;
  const { auth: _drop, ...rest } = opts;
  const shell = createClientCore(url, rest) as Client & AuthApi;
  const authClient = createAuthClient(shell, sessionOpts);
  const merged = mergeClientOptions(rest, authClient, sessionOpts);
  const api = createClientCore(url, merged) as Client & AuthApi;
  authClient.bind(api);
  return attachAuth(api, authClient);
}

function mergeClientOptions(
  base: ClientOptions,
  authClient: AuthClient,
  sessionOpts: CreateAuthClientOptions,
): ClientOptions {
  const fromAuth = authClient.clientOptions;
  const transportAuth: ClientTransportAuth = {
    getToken:
      sessionOpts.getToken ??
      fromAuth.auth?.getToken ??
      (() => null),
    refresh:
      sessionOpts.refresh ??
      fromAuth.auth?.refresh ??
      (async () => null),
  };
  return {
    ...base,
    credentials: fromAuth.credentials ?? base.credentials,
    auth: transportAuth,
    headers: mergeHeaderGetters(base.headers, fromAuth.headers),
  };
}

function mergeHeaderGetters(
  base: ClientOptions["headers"],
  over: (() => Record<string, string>) | undefined,
): ClientOptions["headers"] {
  if (!over) return base;
  if (!base) return over;
  return async () => {
    const a = typeof base === "function" ? await base() : base;
    const b = over();
    return mergeHeaderBags(a, b);
  };
}

function mergeHeaderBags(a: ClientHeaders | undefined, b: Record<string, string>): ClientHeaders {
  if (!a) return b;
  if (!Array.isArray(a)) return { ...a, ...b };
  return [...a, ...Object.entries(b)];
}

/**
 * Attach {@link AuthClient} at `api.auth`, preserving unit Flow access
 * (`api.auth.me`, `api.auth.signInEmail`, …) for unbound props.
 *
 * @param api - Typed client
 * @param auth - Session helper
 */
function attachAuth(api: Client, auth: AuthClient): Client {
  return new Proxy(api as object, {
    get(target, prop, receiver) {
      if (prop === "auth") {
        const flows = Reflect.get(target, "auth", receiver);
        return mergeAuthSurface(auth, flows);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Client;
}

function mergeAuthSurface(auth: AuthClient, flows: unknown): AuthClient {
  return new Proxy(auth as object, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (prop in (target as object)) return Reflect.get(target, prop, receiver);
      if (flows !== null && (typeof flows === "object" || typeof flows === "function")) {
        return Reflect.get(flows as object, prop, flows);
      }
      return undefined;
    },
  }) as AuthClient;
}

/**
 * Thin SSR helper — same {@link createClient} with cookie token from the request.
 *
 * @param req - Incoming request (cookies)
 * @param url - API base URL
 * @param opts - Client options
 */
export function createServerClient(
  req: CookieSource,
  url: string,
  opts: ClientOptions = {},
): Client {
  const prior = opts.auth;
  const sessionBase =
    prior && isSessionAuthOptions(prior)
      ? prior
      : prior && isTransportAuthOnly(prior)
        ? {}
        : ((prior as ClientSessionAuthOptions | undefined) ?? {});
  return createClient(url, {
    ...opts,
    credentials: opts.credentials ?? "include",
    auth: {
      ...sessionBase,
      mode: "cookie",
      csrfConfigured:
        "csrfConfigured" in sessionBase ? sessionBase.csrfConfigured : true,
      getToken: () => tokenFromRequestCookies(req),
    },
  });
}
