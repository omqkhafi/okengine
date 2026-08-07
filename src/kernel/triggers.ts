/**
 * Typed triggers — the left-hand side of `on(Trigger) → Effects`.
 *
 * Five kinds (Linkly + CDC): `http` · `every` · signal-as-trigger ·
 * `table.changed()` · `internal`. All bind the same {@link FlowDef} species.
 */

import type { NamedRef } from "./fx.ts";

/** HTTP methods accepted by {@link http}. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/** Gate reference attached via `.gate(...)`. */
export type GateRef = NamedRef;

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
   * Attach gates (registration order).
   *
   * @param gates - Gate refs
   */
  gate(...gates: GateRef[]): HttpTrigger<M, P>;
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
    gate(...next) {
      return createHttpTrigger(method, path, [...gates, ...next], isLive);
    },
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
 */
export interface ResourceMount {
  readonly [resourceMountBrand]: true;
  readonly mounts: ReadonlyArray<{ readonly trigger: HttpTrigger; readonly flow: unknown }>;
}
/** Brand for {@link ResourceMount}. */
export const resourceMountBrand: unique symbol = Symbol.for("oke.resource.mount");

/**
 * Mount a CRUD resource at `path`: `list`/`create` on the base, `get` /
 * `update` / `remove` on `/:id`. Bind via `on(http.resource(…))`.
 *
 * @param path - Base path (`/notes`)
 * @param ops - The five FlowDefs (usually `resource.all()`)
 */
function httpResource<P extends string>(path: P, ops: ResourceFlowBag): ResourceMount {
  const id = `${path}/:id`;
  return {
    [resourceMountBrand]: true,
    mounts: [
      { trigger: http.get(path), flow: ops.list },
      { trigger: http.post(path), flow: ops.create },
      { trigger: http.get(id), flow: ops.get },
      { trigger: http.patch(id), flow: ops.update },
      { trigger: http.delete(id), flow: ops.remove },
    ],
  };
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
   * Mount a CRUD resource (list/create on `path`, get/update/remove on
   * `path/:id`) for the `on(http.resource(…))` overload.
   */
  resource<P extends string>(path: P, ops: ResourceFlowBag): ResourceMount;
}

/**
 * HTTP trigger constructors — `http.get("/notes")`, `http.post("/links")`, …
 */
export const http: HttpTriggerNamespace = {
  /**
   * @param path - Route path (`/:id` params supported)
   */
  get<P extends string>(path: P): HttpTrigger<"GET", P> {
    return createHttpTrigger("GET", path);
  },
  /**
   * @param path - Route path
   */
  post<P extends string>(path: P): HttpTrigger<"POST", P> {
    return createHttpTrigger("POST", path);
  },
  /**
   * @param path - Route path
   */
  put<P extends string>(path: P): HttpTrigger<"PUT", P> {
    return createHttpTrigger("PUT", path);
  },
  /**
   * @param path - Route path
   */
  patch<P extends string>(path: P): HttpTrigger<"PATCH", P> {
    return createHttpTrigger("PATCH", path);
  },
  /**
   * @param path - Route path
   */
  delete<P extends string>(path: P): HttpTrigger<"DELETE", P> {
    return createHttpTrigger("DELETE", path);
  },
  /**
   * @param path - Route path
   */
  options<P extends string>(path: P): HttpTrigger<"OPTIONS", P> {
    return createHttpTrigger("OPTIONS", path);
  },
  /**
   * @param path - Route path
   */
  head<P extends string>(path: P): HttpTrigger<"HEAD", P> {
    return createHttpTrigger("HEAD", path);
  },
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
