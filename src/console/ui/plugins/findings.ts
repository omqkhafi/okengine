/**
 * Plugin capability-widening findings (console §9.15 · §9.16).
 *
 * Classification comes from Manifest Diff (`diffManifest` → permission-widening
 * on `/plugins/…`). This module only selects those rows — no re-derivation.
 */

import type { DiffChangeRecord } from "../diff/types.ts";

/** One plugin capability widening from Diff. */
export interface PluginCapabilityFinding {
  readonly path: string;
  readonly summary: string;
  readonly kind: DiffChangeRecord["kind"];
}

/**
 * Plugin capability widenings from a Manifest Diff projection.
 *
 * @param changes - Diff panel change rows (already classified)
 */
export function pluginCapabilityFindings(
  changes: readonly DiffChangeRecord[],
): readonly PluginCapabilityFinding[] {
  return changes
    .filter(
      (c) =>
        c.category === "permission-widening" &&
        (c.path.startsWith("/plugins/") ||
          c.path.startsWith("/plugins") ||
          c.summary.toLowerCase().includes("plugin")),
    )
    .map((c) => ({
      path: c.path,
      summary: c.summary,
      kind: c.kind,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
