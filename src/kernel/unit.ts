/**
 * Unit bags — namespace of flows with a `.plug()` attachment point.
 *
 * Provisions: `orders.plug(rateLimit({ max: 30 }))` scopes a plugin to one
 * unit. Plugins queue until an app flushes them at boot / adopt time.
 */

import type { AnyFlowDef, FlowDef } from "./flow.ts";
import type { PluginDef } from "./plugin.ts";

/** Unit handle returned by {@link unit}. */
export interface UnitBag<T extends Record<string, AnyFlowDef> = Record<string, AnyFlowDef>> {
  /** Unit name. */
  readonly name: string;
  /** Flows in this unit. */
  readonly flows: T;
  /**
   * Attach a plugin to every flow in this unit (scope = unit).
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug(pluginDef: PluginDef): UnitBag<T>;
  /** Plugins queued via {@link UnitBag.plug}. */
  readonly pendingPlugins: readonly PluginDef[];
}

/** Queued unit → plugins (consumed by {@link oke}). */
const pendingByUnit = new Map<string, PluginDef[]>();

/**
 * Build a unit bag from named flows. Stamps `unit` + `name` on each flow.
 *
 * @param name - Unit name (client namespace)
 * @param flows - Export map (`{ create, list, … }`)
 */
export function unit<const T extends Record<string, AnyFlowDef>>(
  name: string,
  flows: T,
): UnitBag<T> & T {
  const pending: PluginDef[] = [];
  for (const [exportName, flowDef] of Object.entries(flows)) {
    const f = flowDef as FlowDef;
    if (!f.name || f.name.startsWith("flow_")) {
      (f as { name: string }).name = `${name}.${exportName}`;
    }
    if (!f.unit) {
      (f as { unit: string }).unit = name;
    }
  }

  const bag: UnitBag<T> = {
    name,
    flows,
    pendingPlugins: pending,
    plug(pluginDef) {
      pending.push(pluginDef);
      const list = pendingByUnit.get(name) ?? [];
      list.push(pluginDef);
      pendingByUnit.set(name, list);
      for (const flowDef of Object.values(flows)) {
        flowDef.plug(pluginDef);
      }
      return bag as UnitBag<T> & T;
    },
  };

  return Object.assign(bag, flows) as UnitBag<T> & T;
}

/**
 * Drain unit-scoped plugins registered via {@link unit}.plug.
 *
 * @internal
 */
export function consumeUnitPlugins(): ReadonlyMap<string, readonly PluginDef[]> {
  const snapshot = new Map(pendingByUnit);
  pendingByUnit.clear();
  return snapshot;
}

/**
 * Clear unit plugin queue (tests).
 *
 * @internal
 */
export function resetUnitPlugins(): void {
  pendingByUnit.clear();
}
