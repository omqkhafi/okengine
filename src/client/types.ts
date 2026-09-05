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
  /** Live signal name when this flow is an SSE exposure. */
  readonly live?: string;
  /** Auto-match path-param names (empty = firehose). */
  readonly matchKey?: readonly string[];
  /** Flattened gate names on the HTTP trigger. */
  readonly gates?: readonly string[];
  /** True when this flow returns `text/event-stream`. */
  readonly stream?: true;
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

/** Next / previous list request — TanStack `pageParam` / URL bag. */
export type ClientPagerLink = {
  readonly cursor: string;
};

/**
 * Optional list pager on success `meta`. `next` / `prev` are request bags.
 */
export type ClientListMeta = {
  readonly mode?: "offset" | "cursor";
  readonly limit?: number;
  readonly next?: ClientPagerLink | null;
  readonly prev?: ClientPagerLink | null;
  readonly total?: number;
  readonly offset?: number;
};

/**
 * Wire envelope — `{ data, error, meta? }` before pager methods attach.
 *
 * @typeParam O - Success data
 * @typeParam E - Declared error map
 */
export type ClientEnvelope<
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
> =
  | {
      readonly data: O;
      readonly error: null;
      readonly meta?: ClientListMeta;
    }
  | { readonly data: null; readonly error: ClientError<E> | TransportError };

/**
 * Client call result — envelope plus always-callable `next` / `prev`.
 * Async-iterable: this page, then `next()`, stop when `meta.next` is null.
 *
 * @typeParam O - Success data
 * @typeParam E - Declared error map
 */
export type ClientResult<
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
> = ClientEnvelope<O, E> & {
  /** Next list page, or an empty success when there isn't one. */
  readonly next: () => Promise<ClientResult<O, E>>;
  /** Previous list page, or an empty success when there isn't one. */
  readonly prev: () => Promise<ClientResult<O, E>>;
} & AsyncIterable<ClientResult<O, E>>;

/** Minimal fetch signature (avoids DOM `HeadersInit` / `preconnect` coupling). */
export type ClientFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Header bag accepted by the client. */
export type ClientHeaders = Record<string, string> | [string, string][];

/**
 * Fetch credentials mode (avoids DOM `RequestCredentials` coupling).
 * Use `"include"` for cookie sessions.
 */
export type ClientCredentials = "include" | "omit" | "same-origin";

/**
 * Raw request body accepted by the transport (avoids DOM `BodyInit` coupling).
 * Mirrors what {@link createTransport} treats as non-JSON via `instanceof` checks.
 */
export type ClientBodyInit =
  | Blob
  | FormData
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream
  | string
  | URLSearchParams;

/**
 * Bare transport Bearer hooks (no {@link AuthClient}).
 * Prefer session options (`mode` / `persist` / `csrfConfigured`) so
 * `createClient` attaches `api.auth`.
 */
export interface ClientTransportAuth {
  /** Current access token (Bearer), or null. */
  readonly getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Obtain a new access token after 401. */
  readonly refresh: () => Promise<string | null | undefined>;
}

/**
 * Session orchestration options for `createClient({ auth })` → `api.auth`.
 * Mirrors {@link CreateAuthClientOptions} plus optional SSR token overrides.
 */
export interface ClientSessionAuthOptions {
  readonly mode?: "bearer" | "cookie";
  readonly persist?: "memory" | "sessionStorage" | "localStorage";
  readonly storageKey?: string;
  readonly tenantHeader?: string;
  readonly csrfConfigured?: boolean;
  readonly session?: import("./auth/session.ts").MemorySession;
  readonly env?: {
    readonly localStorage?: Storage;
    readonly sessionStorage?: Storage;
    readonly warn?: (message: string) => void;
  };
  /** SSR / custom: override Bearer getToken (cookie mode still uses credentials). */
  readonly getToken?: ClientTransportAuth["getToken"];
  /** SSR / custom: override refresh after 401. */
  readonly refresh?: ClientTransportAuth["refresh"];
}

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
   * Session orchestration (`mode` / `csrfConfigured` / …) → attaches `api.auth`,
   * or bare `{ getToken, refresh }` transport hooks only.
   */
  readonly auth?: ClientTransportAuth | ClientSessionAuthOptions;
  /**
   * Fetch credentials mode. Use `"include"` for cookie sessions
   * (`gate.auth.cookies` + `createClient({ auth: { mode: "cookie" } })`).
   */
  readonly credentials?: ClientCredentials;
  /**
   * Optional AbortSignal for all calls from this client (per-call override
   * not yet exposed on the proxy).
   */
  readonly signal?: AbortSignal;
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
 * `await list()` is one page; `for await (const page of list())` walks.
 *
 * @typeParam T - Page result
 */
export type ClientThenableIterable<T> = PromiseLike<T> & AsyncIterable<T>;

/**
 * Per-call options on a Flow invoke (binary decode / abort).
 */
export interface ClientCallOpts {
  readonly response?: "json" | "blob" | "arrayBuffer";
  readonly signal?: AbortSignal;
}

/**
 * Call signature for one flow — thenable (one page) and async-iterable (walk).
 *
 * @typeParam I - Input
 * @typeParam O - Output
 * @typeParam E - Errors
 */
type ClientCallFn<I, O, E extends Record<string, unknown>> = [I] extends [void]
  ? {
      (): ClientThenableIterable<ClientResult<O, E>>;
      (opts: ClientCallOpts): ClientThenableIterable<ClientResult<O, E>>;
    }
  : Partial<I> extends I
    ? {
        (input?: I, opts?: ClientCallOpts): ClientThenableIterable<ClientResult<O, E>>;
      }
    : {
        (input: I, opts?: ClientCallOpts): ClientThenableIterable<ClientResult<O, E>>;
      };

/**
 * Call signature for one flow. No `.pages()` — iterate the call or the page.
 *
 * @typeParam I - Input
 * @typeParam O - Output
 * @typeParam E - Errors
 */
export type ClientCall<I, O, E extends Record<string, unknown>> = ClientCallFn<I, O, E>;

/** Unsubscribe a live SSE subscription. */
export type LiveUnsubscribe = () => void;

/**
 * Callbacks for {@link ClientLive} / live-exposing flow calls.
 *
 * @typeParam T - Signal payload
 */
export interface LiveHandlers<T> {
  readonly onEvent: (event: T) => void;
  readonly onError?: (error: unknown) => void;
  /** Fired after a successful SSE open (HTTP 200), including reconnects. */
  readonly onOpen?: () => void;
  /**
   * Re-open the SSE request after a drop. Default false.
   * Reconnects send `Last-Event-ID` when a cursor was received.
   * A 410 LiveResumeGap clears the cursor and replays the remaining tape.
   * Backoff starts at 500ms and doubles to 30s so a closed stream cannot
   * tight-loop reconnects.
   */
  readonly autoResubscribe?: boolean;
  /** Disambiguate when two exposures share a match shape. `unit.flow`. */
  readonly via?: string;
  readonly signal?: AbortSignal;
}

/** Named live signal handle (`signal()`). */
export type LiveSignalHandle<T = unknown> = {
  readonly name: string;
  readonly _payload?: T;
};

/** Filter fields for a live subscribe (path params / payload keys). */
export type LiveInput<T> = T extends object
  ? Partial<T> & Record<string, unknown>
  : Record<string, unknown>;

/**
 * Root `api.live(signal, …)` — callback subscribe, not `for await`.
 *
 * @typeParam App - App brand (reserved; runtime uses `$routes`)
 */
export type ClientLive<App = never> = [App] extends [never]
  ? ClientLiveOverloads
  : ClientLiveOverloads;

type ClientLiveOverloads = {
  <T>(signal: LiveSignalHandle<T>, input: LiveInput<T>, handlers: LiveHandlers<T>): LiveUnsubscribe;
  <T>(signal: LiveSignalHandle<T>, handlers: LiveHandlers<T>): LiveUnsubscribe;
  <T>(name: string, input: unknown, handlers: LiveHandlers<T>): LiveUnsubscribe;
  <T>(name: string, handlers: LiveHandlers<T>): LiveUnsubscribe;
};

type IsLiveContract<C> = C extends { readonly live: string } ? true : false;

type IsStreamOnlyContract<C> = C extends { readonly stream: true }
  ? IsLiveContract<C> extends true
    ? false
    : true
  : false;

type ClientLiveFlowCall<I, O> = [I] extends [void]
  ? (handlers: LiveHandlers<O>) => LiveUnsubscribe
  : Partial<I> extends I
    ? {
        (handlers: LiveHandlers<O>): LiveUnsubscribe;
        (input?: I, handlers?: LiveHandlers<O>): LiveUnsubscribe;
      }
    : (input: I, handlers: LiveHandlers<O>) => LiveUnsubscribe;

type ClientStreamCall<I, O> = [I] extends [void]
  ? (opts?: { readonly signal?: AbortSignal }) => AsyncIterable<O>
  : Partial<I> extends I
    ? (input?: I, opts?: { readonly signal?: AbortSignal }) => AsyncIterable<O>
    : (input: I, opts?: { readonly signal?: AbortSignal }) => AsyncIterable<O>;

type ClientCallFor<C> =
  IsLiveContract<C> extends true
    ? ClientLiveFlowCall<ContractIn<C>, ContractOut<C>>
    : IsStreamOnlyContract<C> extends true
      ? ClientStreamCall<ContractIn<C>, ContractOut<C>>
      : ClientCall<ContractIn<C>, ContractOut<C>, ContractErrors<C>>;

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
    readonly [F in keyof R[U]]: ClientCallFor<R[U][F]>;
  };
};

/**
 * Fully typed client for an App.
 *
 * `live` is always on the instance. Pass `typeof app` / `$routes` so unit
 * bags exist on the type — an empty-`$routes` client cannot be asserted onto
 * `{ console: … }` (TS2352).
 *
 * @typeParam App - App or route map
 */
export type Client<App = never> = ClientFromRoutes<RoutesOf<ResolveApp<App>>> & {
  readonly live: ClientLive<ResolveApp<App>>;
  /**
   * Present when `createClient` was constructed with session `auth` options
   * (`mode` / `persist` / `csrfConfigured` / …). Merged over the `auth` unit
   * Flows at runtime (`api.auth.me` still works).
   */
  readonly auth?: import("./auth/create-auth-client.ts").AuthClient;
};

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
        readonly live?: string;
        readonly stream?: true;
        readonly matchKey?: readonly string[];
        readonly gates?: readonly string[];
      };
    };
  };
}
