/**
 * Store explorer — facet bands → store folders → child resources.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { ArrowDown01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StoreListChild, StoreListStore } from "@/client.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import {
  bandStoreTree,
  filterStoreTree,
  STORE_FACET_SPECS,
  type StoreFacetBand,
  type StoreTreeStore,
} from "../lib/store-tree.ts";

/** Props for {@link StoreTree}. */
export interface StoreTreeProps {
  readonly stores: readonly StoreListStore[];
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
}

/**
 * Searchable, collapsible facet → store → child list.
 *
 * @param props - Stores + selection
 */
export function StoreTree({ stores, selectedEffectRef, onSelect }: StoreTreeProps): JSX.Element {
  const [query, setQuery] = useState("");
  const bands = useMemo(() => bandStoreTree(filterStoreTree(stores, query)), [stores, query]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="store-tree">
      <div className="shrink-0 border-b border-border/60">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stores…"
          aria-label="Search stores"
          className="h-8 min-w-0 rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          data-slot="store-search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {bands.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No stores match.</p>
        ) : (
          <div className="flex flex-col">
            {bands.map((band) => (
              <FacetBand
                key={band.facet}
                band={band}
                selectedEffectRef={selectedEffectRef}
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
 * One facet band (SQL / KV / Files / Index) with tinted icon header.
 *
 * @param props - Band + selection
 */
function FacetBand({
  band,
  selectedEffectRef,
  onSelect,
}: {
  readonly band: StoreFacetBand;
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
}): JSX.Element {
  const facetSpec = STORE_FACET_SPECS[band.facet];
  const childCount = band.stores.reduce((n, s) => n + s.children.length, 0);
  const containsSelected = band.stores.some((s) =>
    s.children.some((c) => c.effectRef === selectedEffectRef),
  );
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected, selectedEffectRef]);

  return (
    <section
      data-slot="store-facet-band"
      data-facet={band.facet}
      aria-label={band.label}
      className="overflow-hidden border-b border-border/60 bg-muted/15 last:border-b-0"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="group/band flex w-full items-center gap-1.5 border-b border-border/50 bg-muted/25 px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
          data-slot="store-facet-band-toggle"
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
              facetSpec.wellClass,
            )}
            aria-hidden
          >
            <HugeiconsIcon icon={facetSpec.icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase group-hover/band:text-foreground">
            {band.label}
          </span>
          <span className="shrink-0 rounded border border-border/60 bg-background/50 px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
            {childCount}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex flex-col gap-0.5 p-1">
            {band.stores.map((node) => (
              <StoreGroupItem
                key={node.store.ref}
                node={node}
                facetWellClass={facetSpec.wellClass}
                facetIcon={facetSpec.icon}
                selectedEffectRef={selectedEffectRef}
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
 * One store folder under a facet band.
 *
 * @param props - Store node + facet chrome + selection
 */
function StoreGroupItem({
  node,
  facetWellClass,
  facetIcon,
  selectedEffectRef,
  onSelect,
  defaultOpen,
}: {
  readonly node: StoreTreeStore;
  readonly facetWellClass: string;
  readonly facetIcon: ElementHugeIcon;
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
  readonly defaultOpen: boolean;
}): JSX.Element {
  const containsSelected = node.children.some((c) => c.effectRef === selectedEffectRef);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected, selectedEffectRef]);

  return (
    <li data-slot="store-group" data-ref={node.store.ref}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group/store flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60">
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover/store:text-foreground"
            aria-hidden
          >
            <HugeiconsIcon icon={Folder01Icon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
            {node.store.name}
          </span>
          <span className="shrink-0 rounded border border-border/50 bg-muted/30 px-1.5 py-px text-[10px] font-normal tabular-nums text-muted-foreground">
            {node.children.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-0.5 mb-0.5 ml-2 flex flex-col gap-0.5 border-l border-border/50 pl-2">
            {node.children.map((child) => (
              <ChildListItem
                key={child.effectRef}
                child={child}
                wellClass={facetWellClass}
                icon={facetIcon}
                selected={selectedEffectRef === child.effectRef}
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
 * One selectable child resource row.
 *
 * @param props - Child + facet chrome + selection
 */
function ChildListItem({
  child,
  wellClass,
  icon,
  selected,
  onSelect,
}: {
  readonly child: StoreListChild;
  readonly wellClass: string;
  readonly icon: ElementHugeIcon;
  readonly selected: boolean;
  readonly onSelect: (effectRef: string) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        data-slot="store-child-item"
        data-effect-ref={child.effectRef}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(child.effectRef)}
        className={cn(
          "group/child relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left text-[11px] transition-colors hover:bg-muted/60",
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
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md border",
            wellClass,
          )}
          aria-hidden
        >
          <HugeiconsIcon icon={icon} className="size-3" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono transition-colors group-hover/child:text-foreground",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {child.name}
        </span>
      </button>
    </li>
  );
}
