/**
 * `on(trigger, flow)` — bind a trigger to a Flow.
 *
 * The Flow object is returned unchanged in species: one object, reachable
 * from any trigger kind. Bindings are collected for {@link oke} to adopt.
 * The return type carries the bound trigger so `typeof app` can derive REST.
 */

import type { ClockDecl } from "../elements/clock/declare.ts";
import type { InferBoundaryIn, InferBoundaryOut } from "./boundary-contract.ts";
import { isFlow, type AnyFlowDef, type FlowDef, type FlowErrorMap } from "./flow.ts";
import { lazyRequire } from "./lazy-require.ts";
import {
  isResourceMount,
  normalizeTrigger,
  type BoundTriggerOf,
  type HttpMethod,
  type HttpTrigger,
  type LiveHttpTrigger,
  type McpToolTrigger,
  type ResourceFlowBag,
  type ResourceMount,
  type SignalAsTrigger,
  type SignalSource,
  type Trigger,
} from "./triggers.ts";

/**
 * Sync-load live HTTP synthesis only when `on(http.*.live(signal))` runs.
 * A static import would pin that graph on every `on` / edge ping bundle.
 */
function loadLiveHttp(): typeof import("./live-http.ts") {
  return lazyRequire(import.meta.dir, ["live", "http"].join("-"));
}

/** One registered `on(trigger, flow)` binding. */
export interface Binding {
  readonly trigger: Trigger;
  /** Heterogenous registry — each flow keeps its own `in`/`out` types. */
  readonly flow: AnyFlowDef;
}

const bindings: Binding[] = [];

/**
 * Invoke-contract bag on an HTTP / MCP exposure (type parameter), if any.
 *
 * @typeParam T - Bound trigger
 */
type ExposureContractOf<T> =
  BoundTriggerOf<T> extends HttpTrigger<HttpMethod, string, infer C>
    ? C
    : BoundTriggerOf<T> extends McpToolTrigger<infer C>
      ? C
      : undefined;

/**
 * Input type for `on(trigger, flow)` — exposure `in` wins over the handler.
 *
 * @typeParam T - Trigger argument
 * @typeParam Fallback - FlowDef input from `flow()`
 */
type InferOnIn<T, Fallback> =
  ExposureContractOf<T> extends { readonly in: unknown }
    ? InferBoundaryIn<ExposureContractOf<T>>
    : Fallback;

/**
 * Output type for `on(trigger, flow)` — exposure `out` wins over the handler.
 *
 * @typeParam T - Trigger argument
 * @typeParam Fallback - FlowDef output from `flow()`
 */
type InferOnOut<T, Fallback> =
  ExposureContractOf<T> extends { readonly out: unknown }
    ? InferBoundaryOut<ExposureContractOf<T>>
    : Fallback;

/**
 * Error map for `on(trigger, flow)` — exposure `errors` wins over Flow defaults.
 *
 * @typeParam T - Trigger argument
 * @typeParam Fallback - FlowDef error map from `flow()`
 */
type InferOnErrors<T, Fallback extends FlowErrorMap> =
  ExposureContractOf<T> extends {
    readonly errors: infer E extends FlowErrorMap;
  }
    ? E
    : Fallback;

/**
 * Bind a trigger to a Flow. Returns the same Flow (one species) with the
 * trigger stamped into the type parameter for client route derivation.
 * When the trigger carries an invoke contract (`http.*` / `mcp.tool` bag),
 * `in` / `out` / `errors` are projected onto the returned {@link FlowDef}
 * (same as {@link import("./call.ts").call}).
 *
 * @param trigger - HTTP, named clock, signal handle, CDC, or internal
 * @param flowDef - Flow definition
 */
export function on<
  T extends Trigger | SignalSource | ClockDecl,
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
  D extends Record<string, unknown> = {},
>(
  trigger: T,
  flowDef: FlowDef<I, O, E, D, Trigger | undefined>,
): FlowDef<InferOnIn<T, I>, InferOnOut<T, O>, InferOnErrors<T, E>, D, BoundTriggerOf<T>>;
/**
 * Expose a live signal: `on(http.get(path).gate(g).live(signal))`.
 * Synthesizes the stream Flow (name stamped by `.adopt`).
 *
 * @param trigger - HTTP GET with `.live(signal)`
 */
export function on<T extends LiveHttpTrigger<HttpMethod, string>>(
  trigger: T,
): FlowDef<unknown, unknown, FlowErrorMap, {}, T>;
/**
 * Mount a CRUD resource (`http.resource(path, ops)`): registers the five
 * verb bindings and returns the ops bag (unit keys `list` · `create` ·
 * `get` · `update` · `remove`) for `.adopt({ notes })`.
 *
 * @param mount - Branded {@link ResourceMount}
 */
export function on(mount: ResourceMount): ResourceFlowBag;
export function on(
  triggerOrMount: Trigger | SignalSource | ClockDecl | ResourceMount,
  flowDef?: FlowDef<any, any, any, any, Trigger | undefined>,
): unknown {
  if (isResourceMount(triggerOrMount)) {
    if (flowDef !== undefined) {
      throw new TypeError("on(http.resource(...)) takes no second argument");
    }
    const byIdVerb: Partial<Record<string, "get" | "update" | "remove">> = {
      GET: "get",
      PATCH: "update",
      DELETE: "remove",
    };
    const baseVerb: Partial<Record<string, "list" | "create">> = {
      GET: "list",
      POST: "create",
    };
    const ops: Record<string, unknown> = {};
    for (const { trigger, flow } of triggerOrMount.mounts) {
      // Live SSE exposure binds through the normal `on()` path below (its
      // trigger carries a liveSignal) — it is not one of the five CRUD ops.
      if (trigger.liveSignal !== undefined) continue;
      const key = trigger.path.endsWith("/:id")
        ? byIdVerb[trigger.method]
        : baseVerb[trigger.method];
      if (key === undefined || !isFlow(flow)) {
        throw new TypeError("on(http.resource(...)) expects the five CRUD FlowDefs");
      }
      on(trigger, flow as FlowDef<any, any, any, any, Trigger | undefined>);
      ops[key] = flow;
    }
    // Live surface — the `<path>/live` mount carries a liveSignal; bind it
    // through `on()` so SSE synthesis + exposure-uniqueness checks run once.
    const liveMount = triggerOrMount.mounts.find((m) => m.trigger.liveSignal !== undefined);
    if (liveMount !== undefined && isFlow(liveMount.flow)) {
      on(liveMount.trigger, liveMount.flow as FlowDef<any, any, any, any, Trigger | undefined>);
    }
    return ops as unknown as ResourceFlowBag;
  }
  const asHttp =
    typeof triggerOrMount === "object" &&
    triggerOrMount !== null &&
    "kind" in triggerOrMount &&
    (triggerOrMount as HttpTrigger).kind === "http"
      ? (triggerOrMount as HttpTrigger)
      : undefined;
  const liveSignal = asHttp?.liveSignal;
  const synthesized = liveSignal !== undefined && flowDef === undefined;
  if (synthesized && asHttp && liveSignal !== undefined) {
    if (asHttp.method !== "GET") {
      throw new TypeError("on(http.*.live(signal)): live exposure must be GET");
    }
    flowDef = loadLiveHttp().synthesizeLiveFlow(liveSignal, asHttp.path) as FlowDef<
      any,
      any,
      any,
      any,
      Trigger | undefined
    >;
  }
  if (!isFlow(flowDef)) {
    throw new TypeError("on() expected a flow() definition as the second argument");
  }
  const normalized = normalizeTrigger(triggerOrMount as Trigger | SignalSource);
  if (normalized.kind === "http" && normalized.liveSignal !== undefined) {
    if (normalized.method !== "GET") {
      throw new TypeError("on(http.*.live(signal)): live exposure must be GET");
    }
    (flowDef as { live: string | undefined }).live = normalized.liveSignal.name;
    if (!synthesized) {
      (flowDef as { liveCustomMatch: boolean }).liveCustomMatch = true;
    }
  }
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  // Stamp runtime carrier for the first bound trigger (type follows BoundTriggerOf).
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  stampExposureContract(flowDef as AnyFlowDef, normalized, triggerOrMount);
  bindings.push({ trigger: normalized, flow: flowDef as AnyFlowDef });
  return flowDef;
}

/**
 * Project invoke / emit contract from the exposure onto the FlowDef for
 * Manifest, validation, and typed client (flat `flows.*.in/out/errors`).
 *
 * Inlined so the edge profile does not pull `boundary-contract` helpers
 * (`call()` / live-http / store.resource still import those from their graphs).
 */
function stampExposureContract(
  flowDef: AnyFlowDef,
  normalized: Trigger,
  raw: Trigger | SignalSource | ClockDecl,
): void {
  if (normalized.kind === "http" || normalized.kind === "mcp") {
    const bag = (normalized as HttpTrigger | McpToolTrigger).contract;
    if (bag === undefined) return;
    flowDef.in = bag.in as AnyFlowDef["in"];
    flowDef.out = bag.out as AnyFlowDef["out"];
    flowDef.errors = bag.errors as AnyFlowDef["errors"];
    if (bag.breaking) flowDef.breaking = true;
    return;
  }
  if (normalized.kind !== "signal") return;
  const handle =
    (normalized as SignalAsTrigger).signal ?? (isSignalSourceWithSchema(raw) ? raw : undefined);
  const schema =
    handle && typeof handle === "object" && "schema" in handle
      ? (handle as { schema?: unknown }).schema
      : undefined;
  if (schema !== undefined && flowDef.in === undefined) {
    flowDef.in = schema as AnyFlowDef["in"];
    flowDef.out = undefined;
    flowDef.errors = undefined;
  }
}

function isSignalSourceWithSchema(value: unknown): value is SignalSource & { schema?: unknown } {
  return typeof value === "object" && value !== null && "name" in value;
}

/**
 * Snapshot of all bindings registered since the last reset.
 */
export function listBindings(): readonly Binding[] {
  return bindings.slice();
}

/**
 * Clear the binding registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetBindings(): void {
  bindings.length = 0;
}
