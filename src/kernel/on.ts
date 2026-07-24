/**
 * `on(trigger, flow)` — bind a trigger to a Flow.
 *
 * The Flow object is returned unchanged in species: one object, reachable
 * from any trigger kind. Bindings are collected for {@link oke} to adopt.
 */

import {
  isFlow,
  type AnyFlowDef,
  type FlowDef,
  type FlowErrorMap,
} from "./flow.ts";
import {
  normalizeTrigger,
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
 * Bind a trigger to a Flow. Returns the same Flow (one species).
 *
 * @param trigger - HTTP, every, signal handle, CDC, or internal
 * @param flowDef - Flow definition
 */
export function on<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
>(
  trigger: Trigger | SignalSource,
  flowDef: FlowDef<I, O, E>,
): FlowDef<I, O, E> {
  if (!isFlow(flowDef)) {
    throw new TypeError("on() expected a flow() definition as the second argument");
  }
  const normalized = normalizeTrigger(trigger);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
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
