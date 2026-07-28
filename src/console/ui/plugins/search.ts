/**
 * URL search params for the Plugins panel (console §9.15).
 */

import type { PluginOrigin, PluginState } from "./types.ts";

/** Typed search for `/plugins`. */
export interface PluginsSearch {
  readonly q?: string;
  readonly origin?: PluginOrigin;
  readonly state?: PluginState;
  readonly plugin?: string;
}

/**
 * Parse router search into {@link PluginsSearch}.
 *
 * @param search - Raw search
 */
export function parsePluginsSearch(search: Record<string, unknown>): PluginsSearch {
  const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
  const origin = isOrigin(search.origin) ? search.origin : undefined;
  const state = search.state === "on" || search.state === "off" ? search.state : undefined;
  const plugin =
    typeof search.plugin === "string" && search.plugin.length > 0 ? search.plugin : undefined;
  return { q, origin, state, plugin };
}

/**
 * Serialize search for the router (omit empties).
 *
 * @param search - Typed search
 */
export function serializePluginsSearch(search: PluginsSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.origin) out.origin = search.origin;
  if (search.state) out.state = search.state;
  if (search.plugin) out.plugin = search.plugin;
  return out;
}

/**
 * Open a plugin in the detail pane (URL).
 *
 * @param search - Current search
 * @param pluginId - Plugin to open
 */
export function openPlugin(search: PluginsSearch, pluginId: string): PluginsSearch {
  return { ...search, plugin: pluginId };
}

function isOrigin(v: unknown): v is PluginOrigin {
  return v === "core" || v === "local" || v === "community";
}
