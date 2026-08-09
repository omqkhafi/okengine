/**
 * Preset switch for {@link createRouter}.
 */

import { createDefaultRouter } from "./create-default.ts";
import { createEdgeRouter } from "./create-edge.ts";
import type { SmartRouter } from "./smart.ts";
import type { RouterPreset } from "./types.ts";

/**
 * Create a router for the given preset.
 *
 * - `default` — SmartRouter(RegExp → Trie), long-lived servers
 * - `edge` — SmartRouter(Linear → Trie), cold-start / one-shot isolates
 *
 * @param preset - Preset name
 */
export function createRouter<T>(preset: RouterPreset = "default"): SmartRouter<T> {
  if (preset === "edge") {
    return createEdgeRouter<T>();
  }
  return createDefaultRouter<T>();
}
