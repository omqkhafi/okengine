/**
 * `on(trigger, flow)` — bind a trigger to a Flow.
 *
 * The Flow object is returned unchanged in species: one object, reachable
 * from any trigger kind. Bindings are collected for {@link oke} to adopt.
 * The return type carries the bound trigger so `typeof app` can derive REST.
 */

import {
  isFlow,
  type AnyFlowDef,
  type FlowDef,
  type FlowErrorMap,
} from "./flow.ts";
import {
  normalizeTrigger,
  type BoundTriggerOf,
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
): FlowDef<I, O, E, D, BoundTriggerOf<T>> {
  if (!isFlow(flowDef)) {
    throw new TypeError("on() expected a flow() definition as the second argument");
  }
  const normalized = normalizeTrigger(trigger);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  // Stamp runtime carrier for the first bound trigger (type follows BoundTriggerOf).
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  bindings.push({ trigger: normalized, flow: flowDef as AnyFlowDef });
  return flowDef as unknown as FlowDef<I, O, E, D, BoundTriggerOf<T>>;
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
