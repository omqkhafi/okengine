/**
 * Copyable install / enable commands — Console never installs (console §9.15).
 */

import type { PluginRecord } from "./types.ts";

/**
 * Command or hint to show for a plugin (copy only — no approve/install).
 *
 * @param plugin - Row
 */
export function copyableCommand(plugin: PluginRecord): string | null {
  if (plugin.installCommand) return plugin.installCommand;
  if (plugin.enableHint) return plugin.enableHint;
  return null;
}

/**
 * Label for the copy control.
 *
 * @param plugin - Row
 */
export function copyCommandLabel(plugin: PluginRecord): string {
  if (plugin.installCommand) return "Copy bun add command";
  if (plugin.enableHint) return "Copy enable hint";
  return "No command";
}
