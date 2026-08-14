/**
 * Units explorer — left tree of Manifest flows grouped by unit.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import {
  ArrowDown01Icon,
  FilterHorizontalIcon,
  Folder01Icon,
  Radio01Icon,
  SecurityCheckIcon,
  Timer01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FlowPlane } from "../../../../../../manifest/types.ts";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_FOLDER_WELL_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_TOOLBAR_CLASS,
  EXPLORER_WELL_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { ExplorerSearch } from "@/components/explorer/explorer-search.tsx";
import { TreeExpandToggle } from "@/components/explorer/tree-expand-toggle.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import {
  FLOW_TRIGGER_KIND_SPECS,
  FLOW_TRIGGER_KINDS,
  flowTriggerKind,
  flowTriggerSpec,
  type FlowTriggerKind,
} from "../lib/flow-trigger.ts";
import {
  bandUnitTree,
  countActiveFacets,
  filterUnitTree,
  filterUnitsAdvanced,
  unitTreeAncestorKeys,
  unitTreeBandKey,
  unitTreeGroupKey,
  unitTreeIsOpen,
  unitTreeOpenKeys,
  type UnitFlowRow,
  type UnitGroup,
  type UnitTreeBand,
  type UnitTreeFacets,
} from "../lib/unit-tree.ts";

/** Props for {@link UnitsTree}. */
export interface UnitsTreeProps {
  readonly groups: readonly UnitGroup[];
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
}

/** Plane facet chips in canonical display order (matches PlaneBadge icons). */
const PLANE_FACETS: Record<FlowPlane, { readonly icon: ElementHugeIcon; readonly label: string }> =
  {
    user: { icon: UserIcon, label: "user" },
    operator: { icon: SecurityCheckIcon, label: "operator" },
  };
const FLOW_PLANES: readonly FlowPlane[] = ["user", "operator"];

/**
 * Searchable, collapsible unit → flow list with advanced facet filters.
 *
 * @param props - Tree + selection
 */
export function UnitsTree({ groups, selectedFlowId, onSelect }: UnitsTreeProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [facets, setFacets] = useState<UnitTreeFacets>({});
  const [openByKey, setOpenByKey] = useState<Readonly<Record<string, boolean>>>({});

  const availableKinds = useMemo(() => {
    const present = new Set<FlowTriggerKind>();
    for (const g of groups) for (const f of g.flows) present.add(flowTriggerKind(f.flow.trigger));
    return FLOW_TRIGGER_KINDS.filter((k) => present.has(k));
  }, [groups]);

  const availablePlanes = useMemo(() => {
    const present = new Set<FlowPlane>();
    for (const g of groups) for (const f of g.flows) if (f.flow.plane) present.add(f.flow.plane);
    return FLOW_PLANES.filter((p) => present.has(p));
  }, [groups]);

  const { hasDurable, hasLive } = useMemo(() => {
    let durable = false;
    let live = false;
    for (const g of groups)
      for (const f of g.flows) {
        if (f.flow.durable) durable = true;
        if (f.flow.live) live = true;
      }
    return { hasDurable: durable, hasLive: live };
  }, [groups]);

  const activeCount = countActiveFacets(facets);
  const bands = useMemo(
    () => bandUnitTree(filterUnitsAdvanced(filterUnitTree(groups, query), facets)),
    [groups, query, facets],
  );
  const keys = useMemo(() => unitTreeOpenKeys(bands), [bands]);
  const searching = query.trim().length > 0;
  const allOpen = keys.length > 0 && keys.every((key) => unitTreeIsOpen(key, openByKey, searching));

  useEffect(() => {
    if (!selectedFlowId) return;
    const ancestors = unitTreeAncestorKeys(bands, selectedFlowId);
    if (ancestors.length === 0) return;
    setOpenByKey((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      for (const key of ancestors) {
        if (next[key] !== true) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedFlowId, bands]);

  const setKeyOpen = (key: string, open: boolean): void => {
    setOpenByKey((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  };

  const toggleAll = (): void => {
    const next = !allOpen;
    setOpenByKey((prev) => {
      const out: Record<string, boolean> = { ...prev };
      for (const key of keys) out[key] = next;
      return out;
    });
  };

  const toggleKind = (kind: FlowTriggerKind) =>
    setFacets((prev) => ({ ...prev, triggerKinds: toggleItem(prev.triggerKinds ?? [], kind) }));
  const togglePlane = (plane: FlowPlane) =>
    setFacets((prev) => ({ ...prev, planes: toggleItem(prev.planes ?? [], plane) }));
  const toggleFlag = (flag: "durableOnly" | "liveOnly") =>
    setFacets((prev) => ({ ...prev, [flag]: !prev[flag] }));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="units-tree">
      <div className="shrink-0 border-b border-border/60">
        <div className={cn(EXPLORER_TOOLBAR_CLASS, "border-b-0")}>
          <ExplorerSearch
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flows…"
            aria-label="Search flows"
            data-slot="units-search"
          />
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="units-advanced-panel"
            data-slot="units-advanced-toggle"
            onClick={() => setAdvancedOpen((open) => !open)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
              advancedOpen || activeCount > 0
                ? "border-foreground/25 bg-background text-foreground shadow-sm"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3" aria-hidden />
            Advanced
            {activeCount > 0 ? (
              <span
                data-slot="units-advanced-count"
                className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-1 text-[9px] font-semibold tabular-nums"
              >
                {activeCount}
              </span>
            ) : null}
          </button>
          <TreeExpandToggle
            allOpen={allOpen}
            disabled={keys.length === 0}
            onToggle={toggleAll}
            dataSlot="units-tree-expand-toggle"
            className="mr-1.5"
          />
        </div>
        {advancedOpen ? (
          <div
            id="units-advanced-panel"
            data-slot="units-advanced-panel"
            className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 p-2"
          >
            <FacetRow label="Trigger" groupLabel="Trigger kind filter">
              {availableKinds.map((kind) => {
                const spec = FLOW_TRIGGER_KIND_SPECS[kind];
                return (
                  <FacetChip
                    key={kind}
                    icon={spec.icon}
                    label={spec.label}
                    pressed={facets.triggerKinds?.includes(kind) ?? false}
                    onToggle={() => toggleKind(kind)}
                    dataFacet={`kind:${kind}`}
                  />
                );
              })}
            </FacetRow>
            {availablePlanes.length > 0 ? (
              <FacetRow label="Plane" groupLabel="Plane filter">
                {availablePlanes.map((plane) => {
                  const spec = PLANE_FACETS[plane];
                  return (
                    <FacetChip
                      key={plane}
                      icon={spec.icon}
                      label={spec.label}
                      pressed={facets.planes?.includes(plane) ?? false}
                      onToggle={() => togglePlane(plane)}
                      dataFacet={`plane:${plane}`}
                    />
                  );
                })}
              </FacetRow>
            ) : null}
            {hasDurable || hasLive ? (
              <FacetRow label="Flags" groupLabel="Flow flags filter">
                {hasDurable ? (
                  <FacetChip
                    icon={Timer01Icon}
                    label="durable"
                    pressed={facets.durableOnly ?? false}
                    onToggle={() => toggleFlag("durableOnly")}
                    dataFacet="flag:durable"
                  />
                ) : null}
                {hasLive ? (
                  <FacetChip
                    icon={Radio01Icon}
                    label="live"
                    pressed={facets.liveOnly ?? false}
                    onToggle={() => toggleFlag("liveOnly")}
                    dataFacet="flag:live"
                  />
                ) : null}
              </FacetRow>
            ) : null}
            {activeCount > 0 ? (
              <button
                type="button"
                data-slot="units-advanced-clear"
                onClick={() => setFacets({})}
                className="self-end text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {bands.length === 0 ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS}>No flows match.</p>
        ) : (
          <div className="flex flex-col">
            {bands.map((band) => {
              const bandKey = unitTreeBandKey(band.id);
              return (
                <TriggerBand
                  key={band.id}
                  band={band}
                  open={unitTreeIsOpen(bandKey, openByKey, searching)}
                  onOpenChange={(open) => setKeyOpen(bandKey, open)}
                  groupOpen={(unit) =>
                    unitTreeIsOpen(unitTreeGroupKey(band.id, unit), openByKey, searching)
                  }
                  onGroupOpenChange={(unit, open) =>
                    setKeyOpen(unitTreeGroupKey(band.id, unit), open)
                  }
                  selectedFlowId={selectedFlowId}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One labelled facet row (Trigger / Plane / Flags) with chip group.
 *
 * @param props - Row label + chips
 */
function FacetRow({
  label,
  groupLabel,
  children,
}: {
  readonly label: string;
  readonly groupLabel: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
        role="group"
        aria-label={groupLabel}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One toggleable facet chip (Traces status-filter aesthetic).
 *
 * @param props - Icon, label, pressed state, toggle handler
 */
function FacetChip({
  icon,
  label,
  pressed,
  onToggle,
  dataFacet,
}: {
  readonly icon: ElementHugeIcon;
  readonly label: string;
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly dataFacet: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-slot="units-facet-chip"
      data-facet={dataFacet}
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        pressed
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Toggle an item in a readonly list (immutable).
 *
 * @param list - Current selection
 * @param item - Item to add/remove
 */
function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * Top-level trigger-kind category with its unit folders underneath.
 *
 * Separated as a bordered band; header collapses the whole kind.
 *
 * @param props - Band + selection
 */
function TriggerBand({
  band,
  open,
  onOpenChange,
  groupOpen,
  onGroupOpenChange,
  selectedFlowId,
  onSelect,
}: {
  readonly band: UnitTreeBand;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groupOpen: (unit: string) => boolean;
  readonly onGroupOpenChange: (unit: string, open: boolean) => void;
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
}): JSX.Element {
  const kindSpec = FLOW_TRIGGER_KIND_SPECS[band.id];
  const flowCount = band.groups.reduce((n, g) => n + g.flows.length, 0);
  const units = band.groups.map((g) => g.unit);
  const unitsOpen = units.length > 0 && units.every((unit) => groupOpen(unit));

  const toggleUnits = (): void => {
    const next = !unitsOpen;
    for (const unit of units) onGroupOpenChange(unit, next);
    if (next) onOpenChange(true);
  };

  return (
    <section
      data-slot="units-trigger-band"
      data-band={band.id}
      aria-label={band.label}
      className={EXPLORER_BAND_CLASS}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          nativeButton={false}
          className={EXPLORER_BAND_HEADER_CLASS}
          data-slot="units-trigger-band-toggle"
          render={(props) => (
            <div {...props}>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn(
                  "size-3 shrink-0 text-muted-foreground transition-transform",
                  !open && "-rotate-90",
                )}
                aria-hidden
              />
              <span className={cn(EXPLORER_WELL_CLASS, kindSpec.wellClass)} aria-hidden>
                <HugeiconsIcon icon={kindSpec.icon} className="size-3" />
              </span>
              <span className={cn(EXPLORER_BAND_LABEL_CLASS, "flex-1")}>{band.label}</span>
              <span className={EXPLORER_COUNT_CLASS}>{flowCount}</span>
              <TreeExpandToggle
                allOpen={unitsOpen}
                disabled={units.length === 0}
                onToggle={toggleUnits}
                collapseLabel={`Collapse all in ${band.label}`}
                expandLabel={`Expand all in ${band.label}`}
                dataSlot="units-band-expand-toggle"
                disclose
                bare
              />
            </div>
          )}
        />
        <CollapsibleContent>
          <ul className="flex flex-col gap-0.5 p-1">
            {band.groups.map((g) => (
              <UnitGroupItem
                key={`${band.id}:${g.unit}`}
                group={g}
                open={groupOpen(g.unit)}
                onOpenChange={(next) => onGroupOpenChange(g.unit, next)}
                selectedFlowId={selectedFlowId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/**
 * One unit folder (collapsible) under a trigger band.
 *
 * @param props - Group + selection
 */
function UnitGroupItem({
  group,
  open,
  onOpenChange,
  selectedFlowId,
  onSelect,
}: {
  readonly group: UnitGroup;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
}): JSX.Element {
  return (
    <li data-slot="unit-group" data-unit={group.unit}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group/unit flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60">
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span
            className={cn(EXPLORER_FOLDER_WELL_CLASS, "group-hover/unit:text-foreground")}
            aria-hidden
          >
            <HugeiconsIcon icon={Folder01Icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
            {group.unit}
          </span>
          <span className={EXPLORER_COUNT_CLASS}>{group.flows.length}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-0.5 mb-0.5 ml-2 flex flex-col gap-0.5 border-l border-border/50 pl-2">
            {group.flows.map((f) => (
              <FlowListItem
                key={f.id}
                flow={f}
                selected={selectedFlowId === f.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * One selectable flow row (method badge or trigger icon + action).
 *
 * @param props - Flow + selection
 */
function FlowListItem({
  flow,
  selected,
  onSelect,
}: {
  readonly flow: UnitFlowRow;
  readonly selected: boolean;
  readonly onSelect: (flowId: string) => void;
}): JSX.Element {
  const trigger = flowTriggerSpec(flow.flow.trigger);
  return (
    <li>
      <button
        type="button"
        data-slot="unit-flow-item"
        data-flow-id={flow.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(flow.id)}
        className={cn(EXPLORER_ROW_CLASS, "group/flow", selected && EXPLORER_ROW_SELECTED_CLASS)}
      >
        <span
          aria-hidden
          className={cn(
            EXPLORER_RAIL_CLASS,
            selected ? EXPLORER_RAIL_ACTIVE_CLASS : "bg-transparent",
          )}
        />
        {flow.method ? (
          <HttpMethodBadge method={flow.method} />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <span {...props} className={cn(EXPLORER_WELL_CLASS, trigger.wellClass)} aria-hidden>
                  <HugeiconsIcon icon={trigger.icon} className="size-3" />
                </span>
              )}
            />
            <TooltipContent side="right" className="text-[11px]">
              {trigger.detail ? `${trigger.label} · ${trigger.detail}` : trigger.label}
            </TooltipContent>
          </Tooltip>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono transition-colors group-hover/flow:text-foreground",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {flow.action}
        </span>
      </button>
    </li>
  );
}
