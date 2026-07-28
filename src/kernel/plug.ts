/**
 * `.plug()` — attach a plugin at an attachment point.
 *
 * Scope is the attachment point:
 * - `app.plug()` — app-wide
 * - `unit.plug()` — that unit only
 * - `flow.plug()` — one flow only
 *
 * No `global: true`, no escape hatch, no inheritance rule.
 * The position is the scope.
 *
 * @see docs/spec/console.md §9.15
 */

import type { AnyFlowDef } from "./flow.ts";
import { isPlugin, type DecorationsOf, type PluginDef } from "./plugin.ts";
import { type PluginRegistry, type PluginScope } from "./registry.ts";

/**
 * Apply a plugin to a registry at the given scope.
 *
 * @param registry - App plugin registry
 * @param pluginDef - Plugin definition
 * @param scope - Attachment point
 */
export function applyPlugin(
  registry: PluginRegistry,
  pluginDef: PluginDef,
  scope: PluginScope,
): void {
  if (!isPlugin(pluginDef)) {
    throw new TypeError(".plug() expected a plugin() definition");
  }
  registry.plug(pluginDef, scope);
}

/**
 * Type-level accumulation helper: merge decorations from a plugged plugin.
 *
 * @typeParam Base - Existing decorations
 * @typeParam P - Plugin being plugged
 */
export type AccumulateDecorations<Base extends Record<string, unknown>, P> = Base &
  DecorationsOf<P>;

/** Something that can receive `.plug()` with type accumulation. */
export interface Pluggable<D extends Record<string, unknown> = {}> {
  /**
   * Attach a plugin. Scope is this attachment point.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(pluginDef: P): Pluggable<AccumulateDecorations<D, P>>;
}

/**
 * Resolve the plugin scope for a flow attachment.
 *
 * @param flowDef - Flow being plugged into
 */
export function flowPluginScope(flowDef: AnyFlowDef): PluginScope {
  return { kind: "flow", name: flowDef.name };
}

/**
 * Resolve the plugin scope for a unit attachment.
 *
 * @param unitName - Unit name
 */
export function unitPluginScope(unitName: string): PluginScope {
  return { kind: "unit", name: unitName };
}

/** App-wide plugin scope. */
export const appPluginScope: PluginScope = { kind: "app" };
