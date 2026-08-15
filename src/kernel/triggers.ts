/**
 * Typed triggers — the left-hand side of `on(Trigger) → Effects`.
 *
 * Five kinds (Linkly + CDC): `http` · `every` · signal-as-trigger ·
 * `table.changed()` · `internal`. All bind the same {@link FlowDef} species.
 */

import { flattenGateArgs, GATE_PUBLIC_NAME, type GateAllDecl } from "../elements/gate/flatten.ts";
import type { NamedRef } from "./fx.ts";

/** HTTP methods accepted by {@link http}. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" | "QUERY";

/** Gate reference attached via `.gate(...)`. */
export type GateRef = NamedRef;

/** One `.gate(...)` argument — a named ref, an `all` handle, or an array. */
export type GateArg = GateRef | GateAllDecl | readonly GateArg[];

/**
 * Attach function on an HTTP trigger / resource mount.
 * Call it with members, or use `.public` for the unauthenticated sentinel.
 */
export interface GateAttach<T> {
  (...gates: GateArg[]): T;
  /** Attach {@link gate.public} — same as `.gate(gate.public)`. */
  readonly public: T;
}

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
  /** Whether `.live()` was applied. */
  readonly isLive: boolean;
  /**
   * Attach gates (registration order). `gate.all` handles and arrays flatten.
   * `.gate.public` is the unauthenticated sentinel.
   */
  readonly gate: GateAttach<HttpTrigger<M, P>>;
  /**
   * Mark the HTTP trigger as live (push result to subscribers).
   */
  live(): HttpTrigger<M, P>;
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
 * Callable `.gate(...)` plus `.gate.public` on a trigger or resource mount.
 *
 * @param apply - Rebuild the host with the flattened gate list
 * @param current - Gates already attached
 */
function createGateAttach<T>(
  apply: (next: readonly GateRef[]) => T,
  current: readonly GateRef[],
): GateAttach<T> {
  const attach = ((...next: GateArg[]) =>
    apply([...current, ...flattenGateArgs(next)])) as GateAttach<T>;
  Object.defineProperty(attach, "public", {
    get() {
      return apply([...current, GATE_PUBLIC_NAME]);
    },
    enumerable: true,
  });
  return attach;
}

function createHttpTrigger<M extends HttpMethod, P extends string>(
  method: M,
  path: P,
  gates: readonly GateRef[] = [],
  isLive = false,
): HttpTrigger<M, P> {
  const trigger: HttpTrigger<M, P> = {
    kind: "http",
    method,
    path,
    gates,
    isLive,
    gate: createGateAttach((next) => createHttpTrigger(method, path, next, isLive), gates),
    live() {
      return createHttpTrigger(method, path, gates, true);
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
 * Same chain as {@link HttpTrigger}: `.gate(...)` / `.live()`.
 */
export interface ResourceMount {
  readonly [resourceMountBrand]: true;
  readonly mounts: ReadonlyArray<{ readonly trigger: HttpTrigger; readonly flow: unknown }>;
  readonly gates: readonly GateRef[];
  /** Whether `.live()` was applied (GET list + get). */
  readonly isLive: boolean;
  /**
   * Attach gates to every verb (registration order). `gate.all` and arrays flatten.
   * `.gate.public` is the unauthenticated sentinel.
   */
  readonly gate: GateAttach<ResourceMount>;
  /**
   * Mark list and get as live (GET mounts). Mutations stay request/response.
   */
  live(): ResourceMount;
}
/** Brand for {@link ResourceMount}. */
export const resourceMountBrand: unique symbol = Symbol.for("oke.resource.mount");

/**
 * Mount a CRUD resource at `path`: `list`/`create` on the base, `get` /
 * `update` / `remove` on `/:id`. Bind via `on(http.resource(…))`.
 *
 * @param path - Base path (`/notes`)
 * @param ops - The five FlowDefs (usually `resource.all()`)
 * @param gates - Shared gate chain
 * @param isLive - Live on GET list + get
 */
function httpResource<P extends string>(
  path: P,
  ops: ResourceFlowBag,
  gates: readonly GateRef[] = [],
  isLive = false,
): ResourceMount {
  const id = `${path}/:id` as `${P}/:id`;
  const verb = <M extends HttpMethod>(
    method: M,
    p: P | `${P}/:id`,
    live: boolean,
  ): HttpTrigger<M> => createHttpTrigger(method, p, gates, live);
  const mount: ResourceMount = {
    [resourceMountBrand]: true,
    gates,
    isLive,
    mounts: [
      { trigger: verb("GET", path, isLive), flow: ops.list },
      { trigger: verb("POST", path, false), flow: ops.create },
      { trigger: verb("GET", id, isLive), flow: ops.get },
      { trigger: verb("PATCH", id, false), flow: ops.update },
      { trigger: verb("DELETE", id, false), flow: ops.remove },
    ],
    gate: createGateAttach((next) => httpResource(path, ops, next, isLive), gates),
    live() {
      return httpResource(path, ops, gates, true);
    },
  };
  return mount;
}

/** True when `value` is a {@link ResourceMount}. */
export function isResourceMount(value: unknown): value is ResourceMount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResourceMount)[resourceMountBrand] === true
  );
}

/**
 * Shape of the {@link http} trigger namespace. Each method keeps `P` as a
 * generic type parameter so callers (and the client) retain literal path
 * types for param extraction.
 */
export interface HttpTriggerNamespace {
  /**
   * @param path - Route path (`/:id` params supported)
   */
  get<P extends string>(path: P): HttpTrigger<"GET", P>;
  /**
   * @param path - Route path
   */
  post<P extends string>(path: P): HttpTrigger<"POST", P>;
  /**
   * @param path - Route path
   */
  put<P extends string>(path: P): HttpTrigger<"PUT", P>;
  /**
   * @param path - Route path
   */
  patch<P extends string>(path: P): HttpTrigger<"PATCH", P>;
  /**
   * @param path - Route path
   */
  delete<P extends string>(path: P): HttpTrigger<"DELETE", P>;
  /**
   * @param path - Route path
   */
  options<P extends string>(path: P): HttpTrigger<"OPTIONS", P>;
  /**
   * @param path - Route path
   */
  head<P extends string>(path: P): HttpTrigger<"HEAD", P>;
  /**
   * Safe, idempotent read that carries a JSON body (RFC 10008).
   *
   * @param path - Route path
   */
  query<P extends string>(path: P): HttpTrigger<"QUERY", P>;
  /**
   * Mount a CRUD resource (list/create on `path`, get/update/remove on
   * `path/:id`) for the `on(http.resource(…))` overload. Chain `.gate(...)`
   * and `.live()` like {@link HttpTrigger}.
   */
  resource<P extends string>(path: P, ops: ResourceFlowBag): ResourceMount;
}

/** Bind an HTTP verb constructor (`http.get`, `http.query`, …). */
function httpVerb<M extends HttpMethod>(
  method: M,
): <P extends string>(path: P) => HttpTrigger<M, P> {
  return (path) => createHttpTrigger(method, path);
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
  resource: httpResource,
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
