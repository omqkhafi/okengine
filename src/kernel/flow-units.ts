/**
 * Module-evaluation registry for `src/flows/generated.ts`.
 *
 * Same consume/ignore posture as `on()` / `listBindings()`: generated.ts
 * calls {@link registerFlowUnits}; {@link oke} drains the bag into `$routes`
 * unless `registry: "ignore"`.
 */

import type { AnyFlowDef } from "./flow.ts";
import { isFlow } from "./flow.ts";

/** Unit name → export name → Flow. */
export type FlowUnitBag = {
  readonly [exportName: string]: unknown;
};

const pending: Record<string, FlowUnitBag> = {};

/**
 * Record generated flow units for the next {@link oke} construction.
 *
 * @param units - `{ notes, main, … }` from `generated.ts`
 */
export function registerFlowUnits(units: Record<string, FlowUnitBag>): void {
  Object.assign(pending, units);
}

/**
 * Drain registered units (consume). Clears the registry.
 */
export function consumeRegisteredFlowUnits(): Record<string, FlowUnitBag> {
  const snap: Record<string, FlowUnitBag> = { ...pending };
  resetRegisteredFlowUnits();
  return snap;
}

/**
 * Snapshot without clearing (keep / tests).
 */
export function peekRegisteredFlowUnits(): Record<string, FlowUnitBag> {
  return { ...pending };
}

/**
 * Clear the unit registry (tests / `registry: "consume"` after drain).
 */
export function resetRegisteredFlowUnits(): void {
  for (const key of Object.keys(pending)) {
    delete pending[key];
  }
}

/**
 * Collect FlowDefs from a unit bag (skip non-flow exports).
 *
 * @param bag - Namespace object
 */
export function flowsInUnitBag(bag: FlowUnitBag): AnyFlowDef[] {
  const found: AnyFlowDef[] = [];
  for (const value of Object.values(bag)) {
    if (isFlow(value)) found.push(value);
  }
  return found;
}
