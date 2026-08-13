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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { Input } from "@/components/ui/input";
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

  const toggleKind = (kind: FlowTriggerKind) =>
    setFacets((prev) => ({ ...prev, triggerKinds: toggleItem(prev.triggerKinds ?? [], kind) }));
  const togglePlane = (plane: FlowPlane) =>
    setFacets((prev) => ({ ...prev, planes: toggleItem(prev.planes ?? [], plane) }));
  const toggleFlag = (flag: "durableOnly" | "liveOnly") =>
    setFacets((prev) => ({ ...prev, [flag]: !prev[flag] }));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="units-tree">
      <div className="shrink-0 border-b border-border/60">
        <div className="flex items-center gap-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units…"
            aria-label="Search units"
            className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            data-slot="units-search"
          />
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="units-advanced-panel"
            data-slot="units-advanced-toggle"
            onClick={() => setAdvancedOpen((open) => !open)}
            className={cn(
              "mr-1.5 shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
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
          <p className="px-2 py-4 text-sm text-muted-foreground">No flows match.</p>
        ) : (
          <div className="flex flex-col">
            {bands.map((band) => (
              <TriggerBand
                key={band.id}
                band={band}
                selectedFlowId={selectedFlowId}
                onSelect={onSelect}
              />
            ))}
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
  selectedFlowId,
  onSelect,
}: {
  readonly band: UnitTreeBand;
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
}): JSX.Element {
  const kindSpec = FLOW_TRIGGER_KIND_SPECS[band.id];
  const flowCount = band.groups.reduce((n, g) => n + g.flows.length, 0);
  const containsSelected = band.groups.some((g) => g.flows.some((f) => f.id === selectedFlowId));
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected, selectedFlowId]);

  return (
    <section
      data-slot="units-trigger-band"
      data-band={band.id}
      aria-label={band.label}
      className="overflow-hidden border-b border-border/60 bg-muted/15 last:border-b-0"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="group/band flex w-full items-center gap-1.5 border-b border-border/50 bg-muted/25 px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
          data-slot="units-trigger-band-toggle"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-md border",
              kindSpec.wellClass,
            )}
            aria-hidden
          >
            <HugeiconsIcon icon={kindSpec.icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase group-hover/band:text-foreground">
            {band.label}
          </span>
          <span className="shrink-0 rounded border border-border/60 bg-background/50 px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
            {flowCount}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex flex-col gap-0.5 p-1">
            {band.groups.map((g) => (
              <UnitGroupItem
                key={`${band.id}:${g.unit}`}
                group={g}
                selectedFlowId={selectedFlowId}
                onSelect={onSelect}
                defaultOpen
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
  selectedFlowId,
  onSelect,
  defaultOpen,
}: {
  readonly group: UnitGroup;
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
  readonly defaultOpen: boolean;
}): JSX.Element {
  const containsSelected = group.flows.some((f) => f.id === selectedFlowId);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected, selectedFlowId]);

  return (
    <li data-slot="unit-group" data-unit={group.unit}>
      <Collapsible open={open} onOpenChange={setOpen}>
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
            className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover/unit:text-foreground"
            aria-hidden
          >
            <HugeiconsIcon icon={Folder01Icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
            {group.unit}
          </span>
          <span className="shrink-0 rounded border border-border/50 bg-muted/30 px-1.5 py-px text-[10px] font-normal tabular-nums text-muted-foreground">
            {group.flows.length}
          </span>
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
        className={cn(
          "group/flow relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left text-[11px] transition-colors hover:bg-muted/60",
          selected && "bg-muted/70 text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-0 w-0.5 rounded-full transition-colors",
            selected ? "bg-sky-500" : "bg-transparent",
          )}
        />
        {flow.method ? (
          <HttpMethodBadge method={flow.method} />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <span
                  {...props}
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border",
                    trigger.wellClass,
                  )}
                  aria-hidden
                >
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
