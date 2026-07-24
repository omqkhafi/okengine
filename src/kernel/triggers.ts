/**
 * Typed triggers — the left-hand side of `on(Trigger) → Effects`.
 *
 * Five kinds (Linkly + CDC): `http` · `every` · signal-as-trigger ·
 * `table.changed()` · `internal`. All bind the same {@link FlowDef} species.
 */

import type { NamedRef } from "./fx.ts";

/** HTTP methods accepted by {@link http}. */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/** Gate reference attached via `.gate(...)`. */
export type GateRef = NamedRef;

/** HTTP trigger value. */
export interface HttpTrigger {
  readonly kind: "http";
  readonly method: HttpMethod;
  readonly path: string;
  readonly gates: readonly GateRef[];
  /** Whether `.live()` was applied. */
  readonly isLive: boolean;
  /**
   * Attach gates (registration order).
   *
   * @param gates - Gate refs
   */
  gate(...gates: GateRef[]): HttpTrigger;
  /**
   * Mark the HTTP trigger as live (push result to subscribers).
   */
  live(): HttpTrigger;
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
export type Trigger =
  | HttpTrigger
  | EveryTrigger
  | SignalAsTrigger
  | CdcTrigger
  | InternalTrigger;

/** Trigger kind string. */
export type TriggerKind = Trigger["kind"];

function createHttpTrigger(
  method: HttpMethod,
  path: string,
  gates: readonly GateRef[] = [],
  isLive = false,
): HttpTrigger {
  const trigger: HttpTrigger = {
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

/**
 * HTTP trigger constructors — `http.get("/notes")`, `http.post("/links")`, …
 */
export const http = {
  /**
   * @param path - Route path (`/:id` params supported)
   */
  get(path: string): HttpTrigger {
    return createHttpTrigger("GET", path);
  },
  /**
   * @param path - Route path
   */
  post(path: string): HttpTrigger {
    return createHttpTrigger("POST", path);
  },
  /**
   * @param path - Route path
   */
  put(path: string): HttpTrigger {
    return createHttpTrigger("PUT", path);
  },
  /**
   * @param path - Route path
   */
  patch(path: string): HttpTrigger {
    return createHttpTrigger("PATCH", path);
  },
  /**
   * @param path - Route path
   */
  delete(path: string): HttpTrigger {
    return createHttpTrigger("DELETE", path);
  },
  /**
   * @param path - Route path
   */
  options(path: string): HttpTrigger {
    return createHttpTrigger("OPTIONS", path);
  },
  /**
   * @param path - Route path
   */
  head(path: string): HttpTrigger {
    return createHttpTrigger("HEAD", path);
  },
} as const;

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
export function asSignalTrigger(
  signal: string | SignalSource,
): SignalAsTrigger {
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
 * Prefer an untriggered `flow({…})` when no trigger value is needed.
 */
export const internal: InternalTrigger = { kind: "internal" };

/**
 * Normalize anything accepted by {@link on} into a {@link Trigger}.
 *
 * @param value - Trigger or signal handle
 */
export function normalizeTrigger(value: Trigger | SignalSource): Trigger {
  if (typeof value === "object" && value !== null && "kind" in value) {
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
