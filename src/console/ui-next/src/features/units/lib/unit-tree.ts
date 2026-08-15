/**
 * Group Manifest flows by derived unit for the Units tree.
 */

import type {
  Flow,
  FlowPlane,
  Manifest,
  SignalDelivery,
} from "../../../../../../manifest/types.ts";
import { unitOfFlowId } from "@/features/flows/graph/build-flow-graph.ts";
import {
  FLOW_TRIGGER_KIND_SPECS,
  FLOW_TRIGGER_KINDS,
  flowTriggerKind,
  type FlowTriggerKind,
} from "./flow-trigger.ts";

/** One flow row in the Units explorer. */
export interface UnitFlowRow {
  readonly id: string;
  readonly unit: string;
  readonly action: string;
  readonly flow: Flow;
  readonly method: string | null;
  readonly path: string | null;
  /** Triggering signal name when the flow is signal-triggered. */
  readonly signal: string | null;
  /** Delivery physics of {@link signal}, joined from `manifest.signals`. */
  readonly delivery: SignalDelivery | null;
}

/** One collapsible unit group. */
export interface UnitGroup {
  readonly unit: string;
  readonly flows: readonly UnitFlowRow[];
}

/**
 * One top-level trigger-kind category in the Units tree.
 *
 * One band per populated {@link FLOW_TRIGGER_KINDS} entry (HTTP, Signal, …).
 * Empty bands are omitted. A mixed unit can appear in several bands with
 * only the matching flows.
 */
export interface UnitTreeBand {
  readonly id: FlowTriggerKind;
  readonly label: string;
  readonly groups: readonly UnitGroup[];
}

/**
 * Project filtered unit groups into every trigger-kind band that has flows.
 *
 * Returns {@link FLOW_TRIGGER_KINDS} bands in canonical order, omitting empty
 * bands so the tree stays dense. Unit order inside each band is preserved.
 *
 * @param groups - Flat unit → flow groups (full or filtered)
 */
export function bandUnitTree(groups: readonly UnitGroup[]): readonly UnitTreeBand[] {
  const byKind = new Map<FlowTriggerKind, UnitGroup[]>(
    FLOW_TRIGGER_KINDS.map((kind) => [kind, []]),
  );
  for (const g of groups) {
    const flowsByKind = new Map<FlowTriggerKind, UnitFlowRow[]>();
    for (const f of g.flows) {
      const kind = flowTriggerKind(f.flow.trigger);
      const list = flowsByKind.get(kind) ?? [];
      list.push(f);
      flowsByKind.set(kind, list);
    }
    for (const [kind, flows] of flowsByKind) {
      byKind.get(kind)?.push({ unit: g.unit, flows });
    }
  }
  return FLOW_TRIGGER_KINDS.flatMap((kind) => {
    const kindGroups = byKind.get(kind) ?? [];
    if (kindGroups.length === 0) return [];
    return [
      {
        id: kind,
        label: FLOW_TRIGGER_KIND_SPECS[kind].label,
        groups: kindGroups,
      },
    ];
  });
}

/**
 * Open-state key for a trigger-kind band in the Units tree.
 *
 * @param bandId - Trigger kind
 */
export function unitTreeBandKey(bandId: FlowTriggerKind): string {
  return `band:${bandId}`;
}

/**
 * Open-state key for a unit folder under a trigger band.
 *
 * @param bandId - Trigger kind
 * @param unit - Unit name
 */
export function unitTreeGroupKey(bandId: FlowTriggerKind, unit: string): string {
  return `unit:${bandId}:${unit}`;
}

/**
 * Whether a Units tree node is open. Bands and unit folders default closed
 * so a large HTTP surface stays scannable; a search query defaults them open.
 *
 * @param key - {@link unitTreeBandKey} or {@link unitTreeGroupKey}
 * @param openByKey - Explicit overrides
 * @param searching - When true, unset keys default open so matches are visible
 */
export function unitTreeIsOpen(
  key: string,
  openByKey: Readonly<Record<string, boolean>>,
  searching = false,
): boolean {
  const stored = openByKey[key];
  if (stored !== undefined) return stored;
  return searching;
}

/**
 * Keys for every collapsible node in the filtered tree (bands, then units).
 *
 * @param bands - Visible trigger-kind bands
 */
export function unitTreeOpenKeys(bands: readonly UnitTreeBand[]): string[] {
  const keys: string[] = [];
  for (const band of bands) {
    keys.push(unitTreeBandKey(band.id));
    for (const group of band.groups) {
      keys.push(unitTreeGroupKey(band.id, group.unit));
    }
  }
  return keys;
}

/**
 * Keys that must be open to reveal a selected flow.
 *
 * @param bands - Visible trigger-kind bands
 * @param flowId - Selected flow id
 */
export function unitTreeAncestorKeys(bands: readonly UnitTreeBand[], flowId: string): string[] {
  for (const band of bands) {
    for (const group of band.groups) {
      if (group.flows.some((f) => f.id === flowId)) {
        return [unitTreeBandKey(band.id), unitTreeGroupKey(band.id, group.unit)];
      }
    }
  }
  return [];
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
    const signal = flow.trigger?.signal ?? null;
    const row: UnitFlowRow = {
      id,
      unit,
      action,
      flow,
      method: http?.method ?? null,
      path: http?.path ?? null,
      signal,
      delivery: signal ? (manifest.signals?.[signal]?.delivery ?? null) : null,
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
 * Filter unit groups by a case-insensitive needle (unit, id, method, path, signal, delivery).
 *
 * @param groups - Full tree
 * @param needle - Search text
 */
export function filterUnitTree(groups: readonly UnitGroup[], needle: string): readonly UnitGroup[] {
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
              (f.path?.toLowerCase().includes(q) ?? false) ||
              (f.signal?.toLowerCase().includes(q) ?? false) ||
              (f.delivery?.toLowerCase().includes(q) ?? false),
          );
      return flows.length > 0 ? { unit: g.unit, flows } : null;
    })
    .filter((g): g is UnitGroup => g !== null);
}

/**
 * Advanced facet selection for the Units tree.
 *
 * Every dimension ANDs together; an empty/absent dimension matches
 * everything. Compose with {@link filterUnitTree} for free-text search.
 */
export interface UnitTreeFacets {
  /** Trigger kinds to keep — empty/undefined keeps all kinds. */
  readonly triggerKinds?: readonly FlowTriggerKind[];
  /** Planes to keep — empty/undefined keeps all planes. */
  readonly planes?: readonly FlowPlane[];
  /** Keep only durable flows. */
  readonly durableOnly?: boolean;
  /** Keep only live flows. */
  readonly liveOnly?: boolean;
  /** Signal delivery physics to keep — empty/undefined keeps all. */
  readonly deliveries?: readonly SignalDelivery[];
}

/**
 * Count individually active facet selections (toggle badge).
 *
 * @param facets - Current facet selection
 */
export function countActiveFacets(facets: UnitTreeFacets): number {
  return (
    (facets.triggerKinds?.length ?? 0) +
    (facets.planes?.length ?? 0) +
    (facets.deliveries?.length ?? 0) +
    (facets.durableOnly ? 1 : 0) +
    (facets.liveOnly ? 1 : 0)
  );
}

/**
 * Filter unit groups by advanced facets — trigger kind, plane, delivery, durable, live.
 *
 * Facets AND together and intersect with {@link filterUnitTree} results.
 * A flow without an explicit `plane` counts as `"user"` (Manifest default).
 * Groups left with no flows are dropped.
 *
 * @param groups - Tree to filter (full or text-filtered)
 * @param facets - Facet selection
 */
export function filterUnitsAdvanced(
  groups: readonly UnitGroup[],
  facets: UnitTreeFacets,
): readonly UnitGroup[] {
  const kinds = facets.triggerKinds?.length ? new Set(facets.triggerKinds) : null;
  const planes = facets.planes?.length ? new Set(facets.planes) : null;
  const deliveries = facets.deliveries?.length ? new Set(facets.deliveries) : null;
  const durableOnly = facets.durableOnly === true;
  const liveOnly = facets.liveOnly === true;
  if (!kinds && !planes && !deliveries && !durableOnly && !liveOnly) return groups;
  return groups
    .map((g): UnitGroup | null => {
      const flows = g.flows.filter((f) => {
        if (kinds && !kinds.has(flowTriggerKind(f.flow.trigger))) return false;
        if (planes && !planes.has(f.flow.plane ?? "user")) return false;
        if (deliveries && (f.delivery === null || !deliveries.has(f.delivery))) return false;
        if (durableOnly && !f.flow.durable) return false;
        if (liveOnly && !f.flow.live) return false;
        return true;
      });
      return flows.length > 0 ? { unit: g.unit, flows } : null;
    })
    .filter((g): g is UnitGroup => g !== null);
}
