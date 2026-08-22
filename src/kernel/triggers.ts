/**
 * Typed triggers — the left-hand side of `on(Trigger) → Effects`.
 *
 * Five kinds (Linkly + CDC): `http` · `every` · signal-as-trigger ·
 * `table.changed()` · `internal`. All bind the same {@link FlowDef} species.
 */

import { flattenGateArgs, GATE_PUBLIC_NAME, type GateAllDecl } from "../elements/gate/flatten.ts";
import type { NamedRef } from "./fx.ts";
import { HTTP_PATH_PENDING, type HttpPathPending } from "./http-path-pending.ts";
import { lazyRequire } from "./lazy-require.ts";

export { HTTP_PATH_PENDING, isPendingHttpPath, type HttpPathPending } from "./http-path-pending.ts";

/** HTTP methods accepted by {@link http}. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" | "QUERY";

/** Gate reference attached via `.gate(...)`. */
export type GateRef = NamedRef;

/** One `.gate(...)` argument — a named ref, an `all` handle, or an array. */
export type GateArg = GateRef | GateAllDecl | readonly GateArg[];

/** Attach gates on an HTTP trigger / resource mount. */
export type GateAttach<T> = (...gates: GateArg[]) => T;

/**
 * HTTP trigger value. Method and path are literal type parameters so
 * `typeof app` / the client can derive REST wire shape from the declaration.
 *
 * @typeParam M - HTTP method literal
 * @typeParam P - Path template literal (`/notes/:id`)
 */
export interface HttpTrigger<M extends HttpMethod = HttpMethod, P extends string = string> {
  readonly kind: "http";
  readonly method: M;
  readonly path: P;
  readonly gates: readonly GateRef[];
  /**
   * Signal this GET exposes as a live SSE feed (`undefined` when not a live route).
   */
  readonly liveSignal?: SignalSource;
  /**
   * Attach gates (registration order). `gate.all` handles and arrays flatten.
   */
  readonly gate: GateAttach<HttpTrigger<M, P>>;
  /**
   * Attach the unauthenticated public sentinel.
   */
  public(): HttpTrigger<M, P>;
  /**
   * Expose a `delivery: "live"` signal as SSE on this GET.
   *
   * @param signal - Live signal handle
   */
  live(signal: SignalSource): LiveHttpTrigger<M, P>;
}

/**
 * HTTP GET trigger that exposes a live signal (`on(trigger)` synthesizes the Flow).
 *
 * `.gate` / `.public` keep {@link LiveHttpTrigger.liveSignal} so
 * `on(http.live(signal).gate(member))` typechecks.
 *
 * @typeParam M - HTTP method literal
 * @typeParam P - Path template literal
 */
export interface LiveHttpTrigger<
  M extends HttpMethod = "GET",
  P extends string = string,
> extends HttpTrigger<M, P> {
  readonly liveSignal: SignalSource;
  readonly gate: GateAttach<LiveHttpTrigger<M, P>>;
  public(): LiveHttpTrigger<M, P>;
}

/** Clock / interval trigger (`every("1h")`). */
export interface EveryTrigger {
  readonly kind: "every";
  readonly interval: string;
}

/**
 * Signal used as a trigger — any named signal handle.
 * Delivery physics live on the signal declaration, not here.
 */
export interface SignalAsTrigger {
  readonly kind: "signal";
  readonly name: string;
  /** Original handle (optional). */
  readonly signal?: { readonly name: string };
}

/** CDC trigger from {@link table}.changed(). */
export interface CdcTrigger {
  readonly kind: "cdc";
  readonly table: string;
  readonly column?: string;
  readonly store?: string;
}

/**
 * Explicit internal trigger. A flow with *no* trigger is also call-only —
 * `internal` exists so all five kinds are addressable as values.
 */
export interface InternalTrigger {
  readonly kind: "internal";
}

/** Discriminated union of all trigger kinds. */
export type Trigger = HttpTrigger | EveryTrigger | SignalAsTrigger | CdcTrigger | InternalTrigger;

/** Trigger kind string. */
export type TriggerKind = Trigger["kind"];

/**
 * Callable `.gate(...)` on a trigger or resource mount.
 *
 * @param apply - Rebuild the host with the flattened gate list
 * @param current - Gates already attached
 */
export function createGateAttach<T>(
  apply: (next: readonly GateRef[]) => T,
  current: readonly GateRef[],
): GateAttach<T> {
  return (...next: GateArg[]) => apply([...current, ...flattenGateArgs(next)]);
}

/**
 * Build an HTTP trigger with `.gate` / `.public` / `.live(signal)`.
 *
 * @param method - HTTP verb
 * @param path - Route path
 * @param gates - Attached gate refs
 * @param liveSignal - Live signal when `.live(signal)` was applied
 */
export function createHttpTrigger<M extends HttpMethod, P extends string>(
  method: M,
  path: P,
  gates: readonly GateRef[],
  liveSignal: SignalSource,
): LiveHttpTrigger<M, P>;
export function createHttpTrigger<M extends HttpMethod, P extends string>(
  method: M,
  path: P,
  gates?: readonly GateRef[],
  liveSignal?: SignalSource,
): HttpTrigger<M, P>;
export function createHttpTrigger<M extends HttpMethod, P extends string>(
  method: M,
  path: P,
  gates: readonly GateRef[] = [],
  liveSignal?: SignalSource,
): HttpTrigger<M, P> {
  const trigger: HttpTrigger<M, P> = {
    kind: "http",
    method,
    path,
    gates,
    ...(liveSignal !== undefined ? { liveSignal } : {}),
    gate: createGateAttach((next) => createHttpTrigger(method, path, next, liveSignal), gates),
    public() {
      return createHttpTrigger(method, path, [...gates, GATE_PUBLIC_NAME], liveSignal);
    },
    live(signal: SignalSource) {
      return createHttpTrigger(method, path, gates, signal);
    },
  };
  return trigger;
}

/** Flow shape accepted by {@link http.resource} (duck-typed — any FlowDef). */
export type ResourceFlow = { readonly name: string };

/** The five CRUD ops {@link http.resource} mounts. */
export interface ResourceFlowBag {
  readonly list: unknown;
  readonly create: unknown;
  readonly get: unknown;
  readonly update: unknown;
  readonly remove: unknown;
}

/**
 * A mounted resource — the single argument to the `on(http.resource(…))`
 * overload. Branded so `on` can tell it apart from a plain trigger.
 * Same chain as {@link HttpTrigger}: `.gate(...)` / `.public()`.
 */
export interface ResourceMount {
  readonly [resourceMountBrand]: true;
  readonly mounts: ReadonlyArray<{ readonly trigger: HttpTrigger; readonly flow: unknown }>;
  readonly gates: readonly GateRef[];
  /**
   * Attach gates to every verb (registration order). `gate.all` and arrays flatten.
   */
  readonly gate: GateAttach<ResourceMount>;
  /**
   * Attach the unauthenticated public sentinel to every verb.
   */
  public(): ResourceMount;
}
/** Brand for {@link ResourceMount}. */
export const resourceMountBrand: unique symbol = Symbol.for("oke.resource.mount");

/** True when `value` is a {@link ResourceMount}. */
export function isResourceMount(value: unknown): value is ResourceMount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResourceMount)[resourceMountBrand] === true
  );
}

/**
 * Sync-load `http.resource` only when called. A static import would pin the
 * five-verb mount on every `http` graph, including edge ping apps.
 */
function loadHttpResource(): typeof import("./http-resource.ts") {
  return lazyRequire(import.meta.dir, ["http", "resource"].join("-"));
}

/**
 * Shape of the {@link http} trigger namespace. Each method keeps `P` as a
 * generic type parameter so callers (and the client) retain literal path
 * types for param extraction.
 */
export interface HttpTriggerNamespace {
  /**
   * Pathless — file-tree stamp fills the URL. Unresolved sentinel fails boot.
   */
  get(): HttpTrigger<"GET", HttpPathPending>;
  /**
   * @param path - Route path (`/:id` params supported)
   */
  get<P extends string>(path: P): HttpTrigger<"GET", P>;
  /** Pathless — file-tree stamp fills the URL. */
  post(): HttpTrigger<"POST", HttpPathPending>;
  /**
   * @param path - Route path
   */
  post<P extends string>(path: P): HttpTrigger<"POST", P>;
  /** Pathless — file-tree stamp fills the URL. */
  put(): HttpTrigger<"PUT", HttpPathPending>;
  /**
   * @param path - Route path
   */
  put<P extends string>(path: P): HttpTrigger<"PUT", P>;
  /** Pathless — file-tree stamp fills the URL. */
  patch(): HttpTrigger<"PATCH", HttpPathPending>;
  /**
   * @param path - Route path
   */
  patch<P extends string>(path: P): HttpTrigger<"PATCH", P>;
  /** Pathless — file-tree stamp fills the URL. */
  delete(): HttpTrigger<"DELETE", HttpPathPending>;
  /**
   * @param path - Route path
   */
  delete<P extends string>(path: P): HttpTrigger<"DELETE", P>;
  /** Pathless — file-tree stamp fills the URL. */
  options(): HttpTrigger<"OPTIONS", HttpPathPending>;
  /**
   * @param path - Route path
   */
  options<P extends string>(path: P): HttpTrigger<"OPTIONS", P>;
  /** Pathless — file-tree stamp fills the URL. */
  head(): HttpTrigger<"HEAD", HttpPathPending>;
  /**
   * @param path - Route path
   */
  head<P extends string>(path: P): HttpTrigger<"HEAD", P>;
  /**
   * Safe, idempotent read that carries a JSON body (RFC 10008).
   * Pathless — file-tree stamp fills the URL.
   */
  query(): HttpTrigger<"QUERY", HttpPathPending>;
  /**
   * Safe, idempotent read that carries a JSON body (RFC 10008).
   *
   * @param path - Route path
   */
  query<P extends string>(path: P): HttpTrigger<"QUERY", P>;
  /**
   * Mount a CRUD resource (list/create on `path`, get/update/remove on
   * `path/:id`) for the `on(http.resource(…))` overload. Chain `.gate(...)`
   * and `.public()` like {@link HttpTrigger}.
   */
  resource<P extends string>(path: P, ops: ResourceFlowBag): ResourceMount;
  /**
   * Default live firehose: `GET /_oke/live/{signal}`. Chain `.gate(...)`.
   *
   * @param signal - `delivery: "live"` handle
   */
  live(signal: SignalSource): LiveHttpTrigger<"GET">;
}

/** Bind an HTTP verb constructor (`http.get`, `http.query`, …). */
function httpVerb<M extends HttpMethod>(
  method: M,
): {
  (): HttpTrigger<M, HttpPathPending>;
  <P extends string>(path: P): HttpTrigger<M, P>;
} {
  return ((path?: string) =>
    createHttpTrigger(method, path === undefined ? HTTP_PATH_PENDING : path)) as {
    (): HttpTrigger<M, HttpPathPending>;
    <P extends string>(path: P): HttpTrigger<M, P>;
  };
}

/**
 * HTTP trigger constructors — `http.get("/notes")`, `http.post("/links")`, …
 */
export const http: HttpTriggerNamespace = {
  get: httpVerb("GET"),
  post: httpVerb("POST"),
  put: httpVerb("PUT"),
  patch: httpVerb("PATCH"),
  delete: httpVerb("DELETE"),
  options: httpVerb("OPTIONS"),
  head: httpVerb("HEAD"),
  query: httpVerb("QUERY"),
  resource: (path, ops) => loadHttpResource().httpResource(path, ops),
  live(signal) {
    const path = `/_oke/live/${encodeURIComponent(signal.name)}`;
    return createHttpTrigger("GET", path, [], signal);
  },
};

/**
 * Clock trigger — run on an interval (`every("10m")`, `every("1h")`).
 *
 * @param interval - Duration string
 */
export function every(interval: string): EveryTrigger {
  return { kind: "every", interval };
}

/**
 * Signal declaration handle — enough for `on(linkClicked, …)` before the
 * full `signal()` element (see `src/elements/signal.ts`).
 */
export interface SignalSource {
  readonly name: string;
  readonly delivery?: string;
  readonly retries?: number;
  readonly deadLetter?: boolean;
  readonly optional?: boolean;
}

/**
 * Coerce a signal handle (or bare name) into a signal trigger.
 *
 * @param signal - Signal name or `{ name }` handle
 */
export function asSignalTrigger(signal: string | SignalSource): SignalAsTrigger {
  if (typeof signal === "string") {
    return { kind: "signal", name: signal };
  }
  return { kind: "signal", name: signal.name, signal };
}

/**
 * True when `value` can be used as a signal trigger (`on(linkClicked, …)`).
 *
 * @param value - Unknown
 */
export function isSignalTriggerSource(value: unknown): value is SignalSource {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || typeof (value as { name: unknown }).name !== "string") {
    return false;
  }
  // Already-normalized triggers go through the `kind` path in normalizeTrigger.
  if ("kind" in value) return false;
  // Flows have a `do` handler — never treat them as signals.
  if ("do" in value) return false;
  return true;
}

/** Table handle returned by {@link table}. */
export interface TableHandle {
  readonly name: string;
  /**
   * CDC trigger when `column` (or any column) changes.
   *
   * @param column - Optional column name
   */
  changed(column?: string): CdcTrigger;
}

/**
 * CDC table handle — `table("orders").changed("status")`.
 *
 * @param name - Table name
 * @param store - Optional store name
 */
export function table(name: string, store?: string): TableHandle {
  return {
    name,
    changed(column?: string): CdcTrigger {
      return column === undefined
        ? { kind: "cdc", table: name, store }
        : { kind: "cdc", table: name, column, store };
    },
  };
}

/**
 * Explicit internal / call-only trigger.
 * Prefer an untriggered `flow(name, {…})` when no trigger value is needed.
 */
export const internal: InternalTrigger = { kind: "internal" };

/**
 * Normalize anything accepted by {@link on} into a {@link Trigger}.
 *
 * @param value - Trigger or signal handle
 */
export function normalizeTrigger(value: Trigger | SignalSource): Trigger {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("on() expected a trigger or signal handle");
  }
  if ("kind" in value) {
    const kind = (value as Trigger).kind;
    if (
      kind === "http" ||
      kind === "every" ||
      kind === "signal" ||
      kind === "cdc" ||
      kind === "internal"
    ) {
      return value as Trigger;
    }
  }
  if (isSignalTriggerSource(value)) {
    return asSignalTrigger(value);
  }
  throw new TypeError("on() expected a trigger or signal handle");
}

/**
 * Bound trigger type after {@link on} / {@link normalizeTrigger}.
 *
 * @typeParam T - Argument accepted by {@link on}
 */
export type BoundTriggerOf<T> = T extends Trigger
  ? T
  : T extends SignalSource
    ? SignalAsTrigger
    : Trigger;
