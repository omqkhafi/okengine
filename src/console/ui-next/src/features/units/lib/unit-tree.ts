/**
 * Group Manifest flows by derived unit for the Units tree.
 */

import type { Flow, Manifest } from "../../../../../../manifest/types.ts";
import { unitOfFlowId } from "@/features/flows/graph/build-flow-graph.ts";

/** One flow row in the Units explorer. */
export interface UnitFlowRow {
  readonly id: string;
  readonly unit: string;
  readonly action: string;
  readonly flow: Flow;
  readonly method: string | null;
  readonly path: string | null;
}

/** One collapsible unit group. */
export interface UnitGroup {
  readonly unit: string;
  readonly flows: readonly UnitFlowRow[];
}

/**
 * Project Manifest flows into unit groups (sorted).
 *
 * @param manifest - Current Manifest
 */
export function buildUnitTree(manifest: Manifest | null | undefined): readonly UnitGroup[] {
  const flows = manifest?.flows;
  if (!flows) return [];

  const byUnit = new Map<string, UnitFlowRow[]>();
  for (const [id, flow] of Object.entries(flows)) {
    const unit = unitOfFlowId(id);
    const action = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
    const http = flow.trigger?.http;
    const row: UnitFlowRow = {
      id,
      unit,
      action,
      flow,
      method: http?.method ?? null,
      path: http?.path ?? null,
    };
    const list = byUnit.get(unit) ?? [];
    list.push(row);
    byUnit.set(unit, list);
  }

  return [...byUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, rows]) => ({
      unit,
      flows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    }));
}

/**
 * Filter unit groups by a case-insensitive needle (unit, id, method, path).
 *
 * @param groups - Full tree
 * @param needle - Search text
 */
export function filterUnitTree(
  groups: readonly UnitGroup[],
  needle: string,
): readonly UnitGroup[] {
  const q = needle.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => {
      const unitHit = g.unit.toLowerCase().includes(q);
      const flows = unitHit
        ? g.flows
        : g.flows.filter(
            (f) =>
              f.id.toLowerCase().includes(q) ||
              f.action.toLowerCase().includes(q) ||
              (f.method?.toLowerCase().includes(q) ?? false) ||
              (f.path?.toLowerCase().includes(q) ?? false),
          );
      return flows.length > 0 ? { unit: g.unit, flows } : null;
    })
    .filter((g): g is UnitGroup => g !== null);
}
