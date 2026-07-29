/**
 * `on(trigger, flow)` — bind a trigger to a Flow.
 *
 * The Flow object is returned unchanged in species: one object, reachable
 * from any trigger kind. Bindings are collected for {@link oke} to adopt.
 * The return type carries the bound trigger so `typeof app` can derive REST.
 */

import { isFlow, type AnyFlowDef, type FlowDef, type FlowErrorMap } from "./flow.ts";
import {
  isResourceMount,
  normalizeTrigger,
  type BoundTriggerOf,
  type ResourceFlowBag,
  type ResourceMount,
  type SignalSource,
  type Trigger,
} from "./triggers.ts";

/** One registered `on(trigger, flow)` binding. */
export interface Binding {
  readonly trigger: Trigger;
  /** Heterogenous registry — each flow keeps its own `in`/`out` types. */
  readonly flow: AnyFlowDef;
}

const bindings: Binding[] = [];

/**
 * Bind a trigger to a Flow. Returns the same Flow (one species) with the
 * trigger stamped into the type parameter for client route derivation.
 *
 * @param trigger - HTTP, every, signal handle, CDC, or internal
 * @param flowDef - Flow definition
 */
export function on<
  T extends Trigger | SignalSource,
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
  D extends Record<string, unknown> = {},
>(
  trigger: T,
  flowDef: FlowDef<I, O, E, D, Trigger | undefined>,
): FlowDef<I, O, E, D, BoundTriggerOf<T>>;
/**
 * Mount a CRUD resource (`http.resource(path, ops)`): registers the five
 * verb bindings and returns the ops bag (unit keys `list` · `create` ·
 * `get` · `update` · `remove`) for `.adopt({ notes })`.
 *
 * @param mount - Branded {@link ResourceMount}
 */
export function on(mount: ResourceMount): ResourceFlowBag;
export function on(
  triggerOrMount: Trigger | SignalSource | ResourceMount,
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
      const key = trigger.path.endsWith("/:id")
        ? byIdVerb[trigger.method]
        : baseVerb[trigger.method];
      if (key === undefined || !isFlow(flow)) {
        throw new TypeError("on(http.resource(...)) expects the five CRUD FlowDefs");
      }
      on(trigger, flow as FlowDef<any, any, any, any, Trigger | undefined>);
      ops[key] = flow;
    }
    return ops as unknown as ResourceFlowBag;
  }
  if (!isFlow(flowDef)) {
    throw new TypeError("on() expected a flow() definition as the second argument");
  }
  const normalized = normalizeTrigger(triggerOrMount as Trigger | SignalSource);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  // Stamp runtime carrier for the first bound trigger (type follows BoundTriggerOf).
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  bindings.push({ trigger: normalized, flow: flowDef as AnyFlowDef });
  return flowDef;
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
