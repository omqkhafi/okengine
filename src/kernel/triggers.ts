/**
 * Typed triggers — the left-hand side of `on(Trigger) → Effects`.
 *
 * Five kinds (Linkly + CDC): `http` · `every` · signal-as-trigger ·
 * `table.changed()` · `internal`. All bind the same {@link FlowDef} species.
 */

import { flattenGateArgs, GATE_PUBLIC_NAME, type GateAllDecl } from "../elements/gate/flatten.ts";
import type { ClockDecl } from "../elements/clock/declare.ts";
import type { BoundaryContract } from "./boundary-contract.ts";
import type { NamedRef } from "./fx.ts";
import { HTTP_PATH_PENDING, type HttpPathPending } from "./http-path-pending.ts";
import { lazyRequire } from "./lazy-require.ts";

export { HTTP_PATH_PENDING, isPendingHttpPath, type HttpPathPending } from "./http-path-pending.ts";
export type { BoundaryContract } from "./boundary-contract.ts";

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
 * `C` preserves the invoke-contract bag for {@link on} → `$routes` typing.
 *
 * @typeParam M - HTTP method literal
 * @typeParam P - Path template literal (`/notes/:id`)
 * @typeParam C - Invoke contract bag (or `undefined` when omitted)
 */
export interface HttpTrigger<
  M extends HttpMethod = HttpMethod,
  P extends string = string,
  // Default `any` so `Trigger` accepts contracted + contractless HTTP triggers;
  // verb overloads still pin `C` to `undefined` or the authored bag.
  C extends BoundaryContract | undefined = any,
> {
  readonly kind: "http";
  readonly method: M;
  readonly path: P;
  readonly gates: readonly GateRef[];
  /** Invoke contract authored on the verb options bag. */
  readonly contract?: C extends undefined ? never : C;
  /**
   * Signal this GET exposes as a live SSE feed (`undefined` when not a live route).
   */
  readonly liveSignal?: SignalSource;
  /**
   * Attach gates (registration order). `gate.all` handles and arrays flatten.
   */
  readonly gate: GateAttach<HttpTrigger<M, P, C>>;
  /**
   * Attach the unauthenticated public sentinel.
   */
  public(): HttpTrigger<M, P, C>;
  /**
   * Expose a `delivery: "live"` signal as SSE on this GET.
   *
   * @param signal - Live signal handle
   */
  live(signal: SignalSource): LiveHttpTrigger<M, P, C>;
  /**
   * Declare a live query surface over a table on this GET: same CDC +
   * per-subscriber RLS classification physics as
   * `store.resource(…, { live: true })`, for a hand-written flow. The
   * flow body opens the stream via `liveQuery(fx, table, input)`.
   *
   * @param table - `store.schema.table` (or drizzle/table handle) binding
   */
  live(table: object): LiveHttpTrigger<M, P, C>;
}

/**
 * HTTP GET trigger that exposes a live signal (`on(trigger)` synthesizes the Flow).
 *
 * `.gate` / `.public` keep {@link LiveHttpTrigger.liveSignal} so
 * `on(http.live(signal).gate(member))` typechecks.
 *
 * @typeParam M - HTTP method literal
 * @typeParam P - Path template literal
 * @typeParam C - Invoke contract bag (or `undefined` when omitted)
 */
export interface LiveHttpTrigger<
  M extends HttpMethod = "GET",
  P extends string = string,
  C extends BoundaryContract | undefined = any,
> extends HttpTrigger<M, P, C> {
  readonly liveSignal: SignalSource;
  readonly gate: GateAttach<LiveHttpTrigger<M, P, C>>;
  public(): LiveHttpTrigger<M, P, C>;
}

/** Clock / cron trigger (`clock("daily", { every: "1d" })`). */
export interface ClockTrigger {
  readonly kind: "clock";
  readonly name: string;
  readonly clock?: ClockDecl;
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

/**
 * MCP tool exposure — the per-flow opt-in surface for OAuth-protected
 * user-plane tools (`on(mcp.tool("bookings.create").gate(...), flow)`).
 *
 * Deny-by-default: a flow without this trigger is never listed over MCP.
 * Gates are required (typically `gate.auth` + `gate.scope(...)`) exactly
 * like sensitive HTTP routes.
 */
export interface McpToolTrigger<C extends BoundaryContract | undefined = any> {
  readonly kind: "mcp";
  /** Tool name exposed in MCP `tools/list`. */
  readonly name: string;
  readonly gates: readonly GateRef[];
  /** Invoke contract authored on `mcp.tool(name, bag)`. */
  readonly contract?: C extends undefined ? never : C;
  readonly gate: GateAttach<McpToolTrigger<C>>;
}

/** Discriminated union of all trigger kinds. */
export type Trigger =
  | HttpTrigger
  | ClockTrigger
  | EveryTrigger
  | SignalAsTrigger
  | CdcTrigger
  | InternalTrigger
  | McpToolTrigger;

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
 * @param contract - Invoke contract bag from the verb options
 */
export function createHttpTrigger<
  M extends HttpMethod,
  P extends string,
  C extends BoundaryContract | undefined = undefined,
>(
  method: M,
  path: P,
  gates: readonly GateRef[],
  liveSignal: SignalSource,
  contract?: C,
): LiveHttpTrigger<M, P, C>;
export function createHttpTrigger<
  M extends HttpMethod,
  P extends string,
  C extends BoundaryContract | undefined = undefined,
>(
  method: M,
  path: P,
  gates?: readonly GateRef[],
  liveSignal?: SignalSource,
  contract?: C,
): HttpTrigger<M, P, C>;
export function createHttpTrigger<
  M extends HttpMethod,
  P extends string,
  C extends BoundaryContract | undefined = undefined,
>(
  method: M,
  path: P,
  gates: readonly GateRef[] = [],
  liveSignal?: SignalSource,
  contract?: C,
): HttpTrigger<M, P, C> {
  const trigger = {
    kind: "http" as const,
    method,
    path,
    gates,
    ...(contract !== undefined ? { contract } : {}),
    ...(liveSignal !== undefined ? { liveSignal } : {}),
    gate: createGateAttach(
      (next) => createHttpTrigger(method, path, next, liveSignal, contract),
      gates,
    ),
    public() {
      return createHttpTrigger(method, path, [...gates, GATE_PUBLIC_NAME], liveSignal, contract);
    },
    live(source: SignalSource | object) {
      if (typeof source === "object" && !("name" in source)) {
        // Table binding — declare a live query surface over this table.
        // Same signal name the `store.resource` live surface synthesizes;
        // resolved lazily so triggers.ts stays free of store imports.
        const storeTable = lazyRequire<typeof import("../elements/store/table.ts")>(
          "../elements/store",
          "table",
        );
        const signal = { name: `oke/live/sql:${storeTable.resolveTableName(source)}` };
        return createHttpTrigger(method, path, gates, signal, contract);
      }
      return createHttpTrigger(method, path, gates, source as SignalSource, contract);
    },
  };
  return trigger as HttpTrigger<M, P, C>;
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
  /** Live surface when present — `store.resource(…, { live: true }).all()`. */
  readonly live?: { readonly signal: string; readonly flow: unknown };
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
   * Optional live surface — set by `httpResource` when the ops bag carries
   * `live` (from `store.resource(…, { live: true }).all()`). `on()` then
   * synthesizes the SSE exposure on `<path>/live`.
   */
  readonly live?: { readonly signal: string; readonly flow: unknown };
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
 * types for param extraction. Invoke contracts use an options bag
 * (`http.post({ in, out })` or `http.post("/notes", { in, out })`); the bag
 * type is preserved so {@link on} can project `in` / `out` / `errors` onto
 * `FlowDef` / `$routes`.
 */
export interface HttpTriggerNamespace {
  /** Pathless — file-tree stamp fills the URL. Unresolved sentinel fails boot. */
  get<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"GET", HttpPathPending, C>;
  /**
   * @param path - Route path (`/:id` params supported)
   * @param contract - Invoke contract bag
   */
  get<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"GET", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  post<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"POST", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  post<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"POST", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  put<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"PUT", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  put<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"PUT", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  patch<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"PATCH", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  patch<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"PATCH", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  delete<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"DELETE", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  delete<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"DELETE", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  options<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"OPTIONS", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  options<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"OPTIONS", P, C>;
  /** Pathless — file-tree stamp fills the URL. */
  head<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"HEAD", HttpPathPending, C>;
  /**
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  head<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"HEAD", P, C>;
  /**
   * Safe, idempotent read that carries a JSON body (RFC 10008).
   * Pathless — file-tree stamp fills the URL.
   */
  query<C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<"QUERY", HttpPathPending, C>;
  /**
   * Safe, idempotent read that carries a JSON body (RFC 10008).
   *
   * @param path - Route path
   * @param contract - Invoke contract bag
   */
  query<P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<"QUERY", P, C>;
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

/** True when `value` looks like a {@link BoundaryContract} options bag (not a path). */
function isHttpContractBag(value: unknown): value is BoundaryContract {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return "in" in o || "out" in o || "errors" in o || "breaking" in o;
}

/** Bind an HTTP verb constructor (`http.get`, `http.query`, …). */
function httpVerb<M extends HttpMethod>(
  method: M,
): {
  <C extends BoundaryContract | undefined = undefined>(
    contract?: C,
  ): HttpTrigger<M, HttpPathPending, C>;
  <P extends string, C extends BoundaryContract | undefined = undefined>(
    path: P,
    contract?: C,
  ): HttpTrigger<M, P, C>;
} {
  return ((pathOrContract?: string | BoundaryContract, maybeContract?: BoundaryContract) => {
    if (pathOrContract === undefined) {
      return createHttpTrigger(method, HTTP_PATH_PENDING);
    }
    if (typeof pathOrContract === "string") {
      return createHttpTrigger(method, pathOrContract, [], undefined, maybeContract);
    }
    if (isHttpContractBag(pathOrContract)) {
      return createHttpTrigger(method, HTTP_PATH_PENDING, [], undefined, pathOrContract);
    }
    throw new TypeError(`http.${method.toLowerCase()}(…): expected a path string or contract bag`);
  }) as {
    <C extends BoundaryContract | undefined = undefined>(
      contract?: C,
    ): HttpTrigger<M, HttpPathPending, C>;
    <P extends string, C extends BoundaryContract | undefined = undefined>(
      path: P,
      contract?: C,
    ): HttpTrigger<M, P, C>;
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
 * True when `value` is a declared clock handle (`clock("daily", { every: "1d" })`).
 *
 * @param value - Unknown
 */
export function isClockDecl(value: unknown): value is ClockDecl {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    !("kind" in v) &&
    !("do" in v) &&
    ("cron" in v || "every" in v || "timezone" in v)
  );
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

/**
 * Explicit internal / call-only trigger.
 * Prefer an untriggered `flow(name, {…})` when no trigger value is needed.
 */
export const internal: InternalTrigger = { kind: "internal" };

/**
 * MCP tool namespace — `mcp.tool("bookings.create", { in, out })` marks a flow
 * as an explicitly exposed MCP tool for OAuth user-plane clients. Chain
 * `.gate(...)` like HTTP triggers; no gates ⇒ not exposed (deny-by-default).
 *
 * @param name - Tool name (namespaced, e.g. `bookings.create`)
 */
export const mcp: {
  /**
   * @param name - Tool name
   * @param contract - Invoke contract bag
   */
  tool<C extends BoundaryContract | undefined = undefined>(
    name: string,
    contract?: C,
  ): McpToolTrigger<C>;
} = {
  tool(name: string, contract?: BoundaryContract): McpToolTrigger {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("mcp.tool(name): name is required");
    }
    return withMcpGates(name, [], contract);
  },
};

/** @internal Attach a resolved gate list onto a fresh {@link McpToolTrigger}. */
function withMcpGates<C extends BoundaryContract | undefined = undefined>(
  name: string,
  gates: readonly GateRef[],
  contract?: C,
): McpToolTrigger<C> {
  return {
    kind: "mcp",
    name,
    gates,
    ...(contract !== undefined ? { contract } : {}),
    gate: createGateAttach((next) => withMcpGates(name, next, contract), gates),
  } as McpToolTrigger<C>;
}

/**
 * Normalize anything accepted by {@link on} into a {@link Trigger}.
 *
 * @param value - Trigger, clock, or signal handle
 */
export function normalizeTrigger(value: Trigger | SignalSource | ClockDecl): Trigger {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("on() expected a trigger or signal handle");
  }
  if ("kind" in value) {
    const kind = (value as Trigger).kind;
    if (
      kind === "http" ||
      kind === "clock" ||
      kind === "every" ||
      kind === "signal" ||
      kind === "cdc" ||
      kind === "internal" ||
      kind === "mcp"
    ) {
      return value as Trigger;
    }
  }
  if (isClockDecl(value)) {
    return { kind: "clock", name: value.name, clock: value };
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
  : T extends ClockDecl
    ? ClockTrigger
    : T extends SignalSource
      ? SignalAsTrigger
      : Trigger;
