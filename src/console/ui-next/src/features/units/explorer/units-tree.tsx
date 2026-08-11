/**
 * Units explorer — left tree of Manifest flows grouped by unit.
 */

import { useMemo, useState, type JSX } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  filterUnitTree,
  type UnitFlowRow,
  type UnitGroup,
} from "../lib/unit-tree.ts";

/** Props for {@link UnitsTree}. */
export interface UnitsTreeProps {
  readonly groups: readonly UnitGroup[];
  readonly selectedFlowId: string | null;
  readonly onSelect: (flowId: string) => void;
}

/**
 * Searchable, collapsible unit → flow list.
 *
 * @param props - Tree + selection
 */
export function UnitsTree({
  groups,
  selectedFlowId,
  onSelect,
}: UnitsTreeProps): JSX.Element {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterUnitTree(groups, query), [groups, query]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="units-tree">
      <div className="border-b border-border/60 p-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search units…"
          aria-label="Search units"
          className="h-8"
          data-slot="units-search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No flows match.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((g) => (
              <UnitGroupItem
                key={g.unit}
                group={g}
                selectedFlowId={selectedFlowId}
                onSelect={onSelect}
                defaultOpen
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li data-slot="unit-group" data-unit={group.unit}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-foreground hover:bg-muted/60">
          <span className="font-mono">{group.unit}</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {group.flows.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-1">
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

function FlowListItem({
  flow,
  selected,
  onSelect,
}: {
  readonly flow: UnitFlowRow;
  readonly selected: boolean;
  readonly onSelect: (flowId: string) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        data-slot="unit-flow-item"
        data-flow-id={flow.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(flow.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-muted/60",
          selected && "bg-muted text-foreground",
        )}
      >
        {flow.method ? <HttpMethodBadge method={flow.method} /> : null}
        <span className="min-w-0 flex-1 truncate font-mono">{flow.action}</span>
      </button>
    </li>
  );
}
