/**
 * Group Plugins by origin × state (console §9.15).
 */

import type { PluginsSearch } from "./search.ts";
import type { PluginOrigin, PluginRecord, PluginState, PluginsListGroup } from "./types.ts";

const ORIGIN_LABEL: Record<PluginOrigin, string> = {
  core: "Core",
  local: "Local",
  community: "Community",
};

/**
 * Filter plugins by search, then group by origin (core → local → community).
 *
 * @param plugins - Rows
 * @param search - Filters
 */
export function groupPlugins(
  plugins: readonly PluginRecord[],
  search: PluginsSearch,
): readonly PluginsListGroup[] {
  const q = (search.q ?? "").trim().toLowerCase();
  const filtered = plugins.filter((p) => {
    if (search.origin && p.origin !== search.origin) return false;
    if (search.state && p.state !== search.state) return false;
    if (!q) return true;
    return (
      p.id.toLowerCase().includes(q) ||
      (p.summary?.toLowerCase().includes(q) ?? false) ||
      (p.packageName?.toLowerCase().includes(q) ?? false) ||
      p.declares.some((d) => d.toLowerCase().includes(q)) ||
      p.intercepts.some((i) => i.stage.toLowerCase().includes(q))
    );
  });

  const order: PluginOrigin[] = ["core", "local", "community"];
  const groups: PluginsListGroup[] = [];
  for (const origin of order) {
    const items = filtered
      .filter((p) => p.origin === origin)
      .sort((a, b) => compareStateThenId(a.state, b.state, a.id, b.id));
    if (items.length === 0) continue;
    groups.push({
      id: origin,
      label: ORIGIN_LABEL[origin],
      items,
    });
  }
  return groups;
}

function compareStateThenId(
  aState: PluginState,
  bState: PluginState,
  aId: string,
  bId: string,
): number {
  if (aState !== bState) return aState === "on" ? -1 : 1;
  return aId.localeCompare(bId);
}
