/**
 * Typed client contract surface — type-level only.
 *
 * Same-repo: pass `App` with `$routes` (or a bare route map) to {@link createClient}.
 * Local / separate-repo: augment {@link Register} so `createClient(url)` needs no import.
 */

/**
 * One flow's client contract. `in` / `out` / `errors` are phantom (type-only).
 *
 * @typeParam I - Request input
 * @typeParam O - Success data
 * @typeParam E - Map of error code → data shape
 */
export interface FlowContract<
  I = unknown,
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Phantom input type. */
  readonly in?: I;
  /** Phantom success type. */
  readonly out?: O;
  /** Phantom error map (`FlightFull` → `{ seatsLeft: number }`). */
  readonly errors?: E;
  /** Optional HTTP method when the wire uses REST instead of `/_oke` RPC. */
  readonly method?: string;
  /** Optional HTTP path template (`/notes/:id`). */
  readonly path?: string;
}

/**
 * Unit → flow → contract. Drives `api.notes.get(...)`.
 */
export type ClientRouteMap = {
  readonly [unit: string]: {
    readonly [flow: string]: FlowContract;
  };
};

/**
 * App shape accepted by {@link createClient}. Either a `$routes` carrier
 * (future `typeof app`) or a bare {@link ClientRouteMap}.
 */
export type ClientApp = {
  readonly $routes: ClientRouteMap;
};

/**
 * Module-augmentation slot for modes that skip `import type { App }`.
 *
 * @example
 * ```ts
 * declare module "okengine/client" {
 *   interface Register {
 *     app: { $routes: { notes: { get: { in: { id: string }; out: Note; errors: { NotFound: {} } } } } };
 *   }
 * }
 * ```
 */
export interface Register {
  // intentionally empty — augmented by `oke dev` / `oke client add`
}

/**
 * Resolve the App type: explicit type argument wins; else {@link Register}.
 *
 * @typeParam App - Explicit app / route map
 */
export type ResolveApp<App = never> = [App] extends [never]
  ? Register extends { readonly app: infer A }
    ? A
    : { readonly $routes: {} }
  : App;

/**
 * Extract a {@link ClientRouteMap} from an App type.
 *
 * Accepts `typeof app` (OkeApp with accumulated `$routes`), {@link ClientApp},
 * or a bare route map.
 *
 * @typeParam App - {@link ClientApp}, `typeof app`, or bare route map
 */
export type RoutesOf<App> = App extends { readonly $routes: infer R }
  ? R extends ClientRouteMap
    ? R
    : R extends Record<string, Record<string, FlowContract>>
      ? R
      : {
          [U in keyof R]: {
            [F in keyof R[U]]: R[U][F] extends FlowContract ? R[U][F] : FlowContract;
          };
        }
  : App extends ClientRouteMap
    ? App
    : {};

/**
 * Discriminated flow-boundary error. Narrow with `error.code === "FlightFull"`.
 *
 * @typeParam E - Error code → data map
 */
export type ClientError<E extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof E & string]: {
    readonly code: K;
    readonly data: E[K];
    readonly message?: string;
  };
}[keyof E & string];

/**
 * Transport / protocol failure (not a declared flow error).
 */
export interface TransportError {
  readonly code: "TransportError";
  readonly data: {
    readonly message: string;
    readonly status?: number;
  };
  readonly message?: string;
}

/**
 * Client call result — errors are values, never thrown for flow failures.
 *
 * @typeParam O - Success data
 * @typeParam E - Declared error map
 */
export type ClientResult<
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
> =
  | { readonly data: O; readonly error: null }
  | { readonly data: null; readonly error: ClientError<E> | TransportError };

/** Minimal fetch signature (avoids DOM `HeadersInit` / `preconnect` coupling). */
export type ClientFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Header bag accepted by the client. */
export type ClientHeaders = Record<string, string> | [string, string][];

/**
 * Options for {@link createClient}.
 */
export interface ClientOptions {
  /** Override `globalThis.fetch`. */
  readonly fetch?: ClientFetch;
  /** Static headers, or a getter invoked per request. */
  readonly headers?: ClientHeaders | (() => ClientHeaders | Promise<ClientHeaders>);
  /** Abort the request after this many milliseconds. */
  readonly timeout?: number;
  /** Retry transient failures (network / 5xx). */
  readonly retry?: {
    /** Extra attempts after the first (default 0). */
    readonly retries?: number;
    /** Initial delay in ms (default 50). */
    readonly delay?: number;
    /** Multiplier applied after each retry (default 2). */
    readonly backoff?: number;
  };
  /**
   * Auth token + refresh. On HTTP 401, `refresh` runs once and the
   * request is retried with the new token.
   */
  readonly auth?: {
    /** Current access token (Bearer), or null. */
    readonly getToken: () => string | null | undefined | Promise<string | null | undefined>;
    /** Obtain a new access token after 401. */
    readonly refresh: () => Promise<string | null | undefined>;
  };
  /**
   * Runtime REST table (optional). Keys are `unit.flow`.
   * When absent, the client uses `POST /_oke/{unit}/{flow}` unless
   * {@link ClientOptions.$routes} supplies HTTP method/path from adopt.
   */
  readonly routes?: Readonly<Record<string, { readonly method: string; readonly path: string }>>;
  /**
   * Runtime route map from `app.$routes` (typed adopt). HTTP triggers become
   * REST; flows without method/path fall back to RPC.
   */
  readonly $routes?: ClientRouteMap;
}

/**
 * Call signature for one flow.
 *
 * @typeParam I - Input
 * @typeParam O - Output
 * @typeParam E - Errors
 */
export type ClientCall<I, O, E extends Record<string, unknown>> = [I] extends [void]
  ? () => Promise<ClientResult<O, E>>
  : Partial<I> extends I
    ? (input?: I) => Promise<ClientResult<O, E>>
    : (input: I) => Promise<ClientResult<O, E>>;

/**
 * Pull input from a contract shape (supports required or phantom-optional `in`).
 */
type ContractIn<C> = "in" extends keyof C
  ? [NonNullable<C["in"]>] extends [never]
    ? void
    : NonNullable<C["in"]>
  : void;

/** Pull output from a contract shape. */
type ContractOut<C> = "out" extends keyof C ? NonNullable<C["out"]> : unknown;

/** Pull error map from a contract shape. */
type ContractErrors<C> = "errors" extends keyof C
  ? NonNullable<C["errors"]> extends Record<string, unknown>
    ? NonNullable<C["errors"]>
    : Record<string, never>
  : Record<string, never>;

/**
 * Typed client proxy derived from a route map.
 *
 * @typeParam R - Route map
 */
export type ClientFromRoutes<R extends ClientRouteMap> = {
  readonly [U in keyof R]: {
    readonly [F in keyof R[U]]: ClientCall<
      ContractIn<R[U][F]>,
      ContractOut<R[U][F]>,
      ContractErrors<R[U][F]>
    >;
  };
};

/**
 * Fully typed client for an App.
 *
 * @typeParam App - App or route map
 */
export type Client<App = never> = ClientFromRoutes<RoutesOf<ResolveApp<App>>>;

/**
 * Convenience: brand a route map as an App (`export type App = AppOf<…>`).
 *
 * @typeParam R - Route map
 */
export type AppOf<R extends ClientRouteMap> = { readonly $routes: R };

/**
 * JSON shape served at `GET /_oke/client.json` for {@link clientAdd}.
 */
export interface ClientDescriptor {
  /** Route contracts with TypeScript type strings for emission. */
  readonly routes: {
    readonly [unit: string]: {
      readonly [flow: string]: {
        readonly in?: string;
        readonly out?: string;
        readonly errors?: Readonly<Record<string, string>>;
        readonly method?: string;
        readonly path?: string;
      };
    };
  };
}
