/**
 * Store explorer — facet bands → store folders → child resources.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  ArrowDown01Icon,
  FileSpreadsheetIcon,
  Folder01Icon,
  FunctionIcon,
  HierarchySquare10Icon,
  Key01Icon,
  PuzzleIcon,
  SecurityCheckIcon,
  ShieldEnergyIcon,
  ShieldOff,
  SourceCodeIcon,
  TableIcon,
  ViewIcon,
  ViewOffSlashIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StoreFacet, StoreListChild, StoreListStore } from "@/client.ts";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_FOLDER_WELL_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import {
  bandStoreTree,
  filterStoreTree,
  findByEffectRef,
  loadHiddenFacets,
  saveHiddenFacets,
  STORE_FACET_SPECS,
  storeTreeAncestorKeys,
  storeTreeFacetKey,
  storeTreeIsOpen,
  storeTreeOpenKeys,
  storeTreeTablesKey,
  visibleFacetBands,
  type StoreFacetBand,
  type StoreTreeStore,
} from "../lib/store-tree.ts";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import {
  filesDriverLabel,
  filesDriverOrigin,
  isSingletonFilesBucket,
} from "../lib/files-origin.ts";
import {
  childCatalogKind,
  groupSqlChildren,
  storeChildLabel,
  storeChildShowsRls,
} from "../lib/sql-catalog.ts";
import type { StoreQueryFacet } from "../state/store-selection.ts";

/** Props for {@link StoreTree}. */
export interface StoreTreeProps {
  readonly stores: readonly StoreListStore[];
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
  /** Open query console facet, if any. */
  readonly queryFacet?: StoreQueryFacet | null;
  readonly onOpenQuery?: (facet: StoreQueryFacet) => void;
  /** SQL schema visualizer is the right pane. */
  readonly schemaActive?: boolean;
  readonly onOpenSchema?: () => void;
}

/**
 * Searchable, collapsible facet → store → child list.
 *
 * @param props - Stores + selection
 */
export function StoreTree({
  stores,
  selectedEffectRef,
  onSelect,
  queryFacet = null,
  onOpenQuery,
  schemaActive = false,
  onOpenSchema,
}: StoreTreeProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [openByKey, setOpenByKey] = useState<Readonly<Record<string, boolean>>>({});
  const [hiddenFacets, setHiddenFacets] = useState<ReadonlySet<StoreFacet>>(loadHiddenFacets);
  const allBands = useMemo(() => bandStoreTree(stores), [stores]);
  const bands = useMemo(() => bandStoreTree(filterStoreTree(stores, query)), [stores, query]);
  const visibleBands = useMemo(() => visibleFacetBands(bands, hiddenFacets), [bands, hiddenFacets]);
  const keys = useMemo(() => storeTreeOpenKeys(visibleBands), [visibleBands]);
  const searching = query.trim().length > 0;
  const allOpen = keys.length > 0 && keys.every((key) => storeTreeIsOpen(key, openByKey));

  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedEffectRef) return;
    const ancestors = storeTreeAncestorKeys(stores, selectedEffectRef);
    const facetKey = ancestors.find((key) => key.startsWith("facet:"));
    if (facetKey) {
      setOpenByKey((prev) => (prev[facetKey] === false ? { ...prev, [facetKey]: true } : prev));
    }
    const selectionChanged =
      prevSelectedRef.current !== null && prevSelectedRef.current !== selectedEffectRef;
    prevSelectedRef.current = selectedEffectRef;
    if (!selectionChanged) return;
    const found = findByEffectRef(stores, selectedEffectRef);
    if (!found) return;
    setHiddenFacets((prev) => {
      if (!prev.has(found.store.facet)) return prev;
      const next = new Set(prev);
      next.delete(found.store.facet);
      saveHiddenFacets(next);
      return next;
    });
  }, [selectedEffectRef, stores]);

  const setKeyOpen = (key: string, open: boolean): void => {
    setOpenByKey((prev) => (prev[key] === open ? prev : { ...prev, [key]: open }));
  };

  const setFacetHidden = (facet: StoreFacet, hidden: boolean): void => {
    setHiddenFacets((prev) => {
      if (prev.has(facet) === hidden) return prev;
      const next = new Set(prev);
      if (hidden) next.add(facet);
      else next.delete(facet);
      saveHiddenFacets(next);
      return next;
    });
  };

  const showAllFacets = (): void => {
    setHiddenFacets((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<StoreFacet>();
      saveHiddenFacets(next);
      return next;
    });
  };

  const toggleAll = (): void => {
    const next = !allOpen;
    setOpenByKey((prev) => {
      const out: Record<string, boolean> = { ...prev };
      for (const key of keys) out[key] = next;
      return out;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="store-tree">
      <div className="shrink-0 border-b border-border/60">
        <div className={cn(EXPLORER_TOOLBAR_CLASS, "border-b-0")}>
          <ExplorerSearch
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stores…"
            aria-label="Search stores"
            data-slot="store-search"
          />
          <FacetVisibilityMenu
            bands={allBands}
            hiddenFacets={hiddenFacets}
            onHiddenChange={setFacetHidden}
            onShowAll={showAllFacets}
          />
          <TreeExpandToggle
            allOpen={allOpen}
            disabled={keys.length === 0}
            onToggle={toggleAll}
            dataSlot="store-tree-expand-toggle"
            className="mr-1.5"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {visibleBands.length === 0 ? (
          <p className={EXPLORER_LIST_EMPTY_CLASS}>
            {bands.length === 0 ? "No stores match." : "All facets hidden."}
          </p>
        ) : (
          <div className="flex flex-col">
            {visibleBands.map((band) => {
              const facetKey = storeTreeFacetKey(band.facet);
              return (
                <FacetBand
                  key={band.facet}
                  band={band}
                  onHide={() => setFacetHidden(band.facet, true)}
                  open={storeTreeIsOpen(facetKey, openByKey)}
                  onOpenChange={(open) => setKeyOpen(facetKey, open)}
                  storeOpen={(ref) =>
                    searching ? openByKey[ref] !== false : openByKey[ref] === true
                  }
                  onStoreOpenChange={setKeyOpen}
                  selectedEffectRef={selectedEffectRef}
                  onSelect={onSelect}
                  queryActive={queryFacet === band.facet}
                  onOpenQuery={
                    onOpenQuery && (band.facet === "sql" || band.facet === "kv")
                      ? () => onOpenQuery(band.facet === "kv" ? "kv" : "sql")
                      : undefined
                  }
                  schemaActive={band.facet === "sql" && schemaActive}
                  onOpenSchema={band.facet === "sql" ? onOpenSchema : undefined}
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
 * Search-bar control to show or hide Store facet bands.
 *
 * @param props - Present bands + hidden set + toggles
 */
function FacetVisibilityMenu({
  bands,
  hiddenFacets,
  onHiddenChange,
  onShowAll,
}: {
  readonly bands: readonly StoreFacetBand[];
  readonly hiddenFacets: ReadonlySet<StoreFacet>;
  readonly onHiddenChange: (facet: StoreFacet, hidden: boolean) => void;
  readonly onShowAll: () => void;
}): JSX.Element {
  const hiddenCount = bands.filter((band) => hiddenFacets.has(band.facet)).length;
  const anyHidden = hiddenCount > 0;

  return (
    <DropdownMenu>
      <ToolbarTip label="Show and hide facets">
        <DropdownMenuTrigger
          render={(props) => (
            <button
              {...props}
              type="button"
              aria-label="Show and hide facets"
              data-slot="store-tree-visibility"
              disabled={bands.length === 0}
              className={cn(
                EXPLORER_ICON_BUTTON_CLASS,
                anyHidden && "border-foreground/25 text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={anyHidden ? ViewOffSlashIcon : ViewIcon}
                className="size-3.5"
                aria-hidden
              />
            </button>
          )}
        />
      </ToolbarTip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Facets</DropdownMenuLabel>
          {bands.map((band) => {
            const spec = STORE_FACET_SPECS[band.facet];
            const visible = !hiddenFacets.has(band.facet);
            return (
              <DropdownMenuCheckboxItem
                key={band.facet}
                checked={visible}
                data-slot="store-tree-visibility-facet"
                data-facet={band.facet}
                onCheckedChange={(checked) => onHiddenChange(band.facet, checked === false)}
              >
                <HugeiconsIcon icon={spec.icon} className="size-3.5" aria-hidden />
                {spec.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
        {anyHidden ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-slot="store-tree-visibility-show-all" onClick={onShowAll}>
              Show all
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One facet band (SQL / KV / Files / Index) with tinted icon header.
 *
 * @param props - Band + selection
 */
function FacetBand({
  band,
  onHide,
  open,
  onOpenChange,
  storeOpen,
  onStoreOpenChange,
  selectedEffectRef,
  onSelect,
  queryActive,
  onOpenQuery,
  schemaActive,
  onOpenSchema,
}: {
  readonly band: StoreFacetBand;
  readonly onHide: () => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeOpen: (ref: string) => boolean;
  readonly onStoreOpenChange: (ref: string, open: boolean) => void;
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
  readonly queryActive: boolean;
  readonly onOpenQuery?: () => void;
  readonly schemaActive: boolean;
  readonly onOpenSchema?: () => void;
}): JSX.Element {
  const facetSpec = STORE_FACET_SPECS[band.facet];
  const childCount = band.stores.reduce((n, s) => {
    if (s.store.facet === "sql") return n + groupSqlChildren(s.children).tables.length;
    return n + s.children.length;
  }, 0);
  const storeRefs = band.stores.map((n) => n.store.ref);
  const storesOpen = storeRefs.length > 0 && storeRefs.every((ref) => storeOpen(ref));

  const toggleStores = (): void => {
    const next = !storesOpen;
    for (const ref of storeRefs) onStoreOpenChange(ref, next);
    if (next) onOpenChange(true);
  };

  const identity = (
    <>
      <span className={cn(EXPLORER_WELL_CLASS, facetSpec.wellClass)} aria-hidden>
        <HugeiconsIcon icon={facetSpec.icon} className="size-3" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={EXPLORER_BAND_LABEL_CLASS}>{band.label}</span>
        <span className={EXPLORER_COUNT_CLASS}>{childCount}</span>
      </span>
    </>
  );

  return (
    <section
      data-slot="store-facet-band"
      data-facet={band.facet}
      aria-label={band.label}
      className={EXPLORER_BAND_CLASS}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          nativeButton={false}
          className={EXPLORER_BAND_HEADER_CLASS}
          data-slot="store-facet-band-toggle"
          render={(props) => (
            <div {...props}>
              <TreeChevron open={open} group="band" />
              {identity}
              {onOpenSchema ? (
                <SchemaBandButton active={schemaActive} onOpen={onOpenSchema} />
              ) : null}
              {onOpenQuery ? (
                <QueryBandButton
                  facet={band.facet === "kv" ? "kv" : "sql"}
                  active={queryActive}
                  onOpen={onOpenQuery}
                />
              ) : null}
              <FacetVisibilityButton label={band.label} onHide={onHide} />
              <TreeExpandToggle
                allOpen={storesOpen}
                disabled={storeRefs.length === 0}
                onToggle={toggleStores}
                collapseLabel={`Collapse all in ${band.label}`}
                expandLabel={`Expand all in ${band.label}`}
                dataSlot="store-facet-expand-toggle"
                disclose
                bare
              />
            </div>
          )}
        />
        <CollapsibleContent>
          <ul className="flex flex-col gap-0.5 p-1">
            {band.stores.map((node) => (
              <StoreGroupItem
                key={node.store.ref}
                node={node}
                facetWellClass={facetSpec.wellClass}
                facetIcon={facetSpec.icon}
                open={storeOpen(node.store.ref)}
                onOpenChange={(next) => onStoreOpenChange(node.store.ref, next)}
                tablesOpen={storeOpen(storeTreeTablesKey(node.store.ref))}
                onTablesOpenChange={(next) =>
                  onStoreOpenChange(storeTreeTablesKey(node.store.ref), next)
                }
                selectedEffectRef={selectedEffectRef}
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
 * One store folder under a facet band.
 *
 * @param props - Store node + facet chrome + selection
 */
function StoreGroupItem({
  node,
  facetWellClass,
  facetIcon,
  open,
  onOpenChange,
  tablesOpen,
  onTablesOpenChange,
  selectedEffectRef,
  onSelect,
}: {
  readonly node: StoreTreeStore;
  readonly facetWellClass: string;
  readonly facetIcon: ElementHugeIcon;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly tablesOpen: boolean;
  readonly onTablesOpenChange: (open: boolean) => void;
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
}): JSX.Element {
  const only = node.children[0];
  if (isSingletonFilesBucket(node.store) && only) {
    return (
      <FilesBucketItem
        store={node.store}
        child={only}
        selected={selectedEffectRef === only.effectRef}
        onSelect={onSelect}
      />
    );
  }

  return (
    <li data-slot="store-group" data-ref={node.store.ref}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          nativeButton={false}
          className="group/store flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60"
          data-slot="store-group-toggle"
          render={(props) => (
            <div {...props}>
              <TreeChevron open={open} group="store" />
              <span
                className={cn(EXPLORER_FOLDER_WELL_CLASS, "group-hover/store:text-foreground")}
                aria-hidden
              >
                <HugeiconsIcon icon={Folder01Icon} className="size-3" />
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
                  {node.store.name}
                </span>
                <span className={EXPLORER_COUNT_CLASS}>
                  {node.store.facet === "sql"
                    ? groupSqlChildren(node.children).tables.length
                    : node.children.length}
                </span>
                {node.store.facet === "files" ? (
                  <FilesDriverChip driverId={node.store.driverId} />
                ) : null}
              </span>
              <TreeExpandToggle
                allOpen={open}
                onToggle={() => onOpenChange(!open)}
                collapseLabel={`Collapse ${node.store.name}`}
                expandLabel={`Expand ${node.store.name}`}
                dataSlot="store-group-expand-toggle"
                disclose
                bare
              />
            </div>
          )}
        />
        <CollapsibleContent>
          <SqlStoreChildren
            node={node}
            facetWellClass={facetWellClass}
            facetIcon={facetIcon}
            tablesOpen={tablesOpen}
            onTablesOpenChange={onTablesOpenChange}
            selectedEffectRef={selectedEffectRef}
            onSelect={onSelect}
          />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Tables folder + catalog leaves under a SQL store; flat list otherwise.
 */
function SqlStoreChildren({
  node,
  facetWellClass,
  facetIcon,
  tablesOpen,
  onTablesOpenChange,
  selectedEffectRef,
  onSelect,
}: {
  readonly node: StoreTreeStore;
  readonly facetWellClass: string;
  readonly facetIcon: ElementHugeIcon;
  readonly tablesOpen: boolean;
  readonly onTablesOpenChange: (open: boolean) => void;
  readonly selectedEffectRef: string | null;
  readonly onSelect: (effectRef: string) => void;
}): JSX.Element {
  const grouped = groupSqlChildren(node.children);
  if (node.store.facet !== "sql" || grouped.catalog.length === 0) {
    return (
      <ul className="mt-0.5 mb-0.5 ml-2 flex flex-col gap-0.5 border-l border-border/50 pl-2">
        {node.children.map((child) => (
          <ChildListItem
            key={child.effectRef}
            child={child}
            wellClass={facetWellClass}
            icon={
              node.store.facet === "sql"
                ? FileSpreadsheetIcon
                : node.store.facet === "files"
                  ? Folder01Icon
                  : facetIcon
            }
            hint={node.store.facet === "files" ? "bucket" : undefined}
            selected={selectedEffectRef === child.effectRef}
            onSelect={onSelect}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-0.5 mb-0.5 ml-2 flex flex-col gap-0.5 border-l border-border/50 pl-2">
      <li>
        <Collapsible open={tablesOpen} onOpenChange={onTablesOpenChange}>
          <CollapsibleTrigger
            nativeButton={false}
            className="group/tables group/store flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60"
            data-slot="store-tables-toggle"
            render={(props) => (
              <div {...props}>
                <span className={cn(EXPLORER_WELL_CLASS, facetWellClass)} aria-hidden>
                  <HugeiconsIcon icon={TableIcon} className="size-3" />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-foreground">
                  Tables
                </span>
                <span className={EXPLORER_COUNT_CLASS}>{grouped.tables.length}</span>
                <TreeChevron open={tablesOpen} group="store" />
              </div>
            )}
          />
          <CollapsibleContent>
            <ul className="mt-0.5 mb-0.5 ml-2 flex flex-col gap-0.5 border-l border-border/50 pl-2">
              {grouped.tables.map((child) => (
                <ChildListItem
                  key={child.effectRef}
                  child={child}
                  wellClass={facetWellClass}
                  icon={FileSpreadsheetIcon}
                  selected={selectedEffectRef === child.effectRef}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </li>
      {grouped.catalog.map((child) => (
        <ChildListItem
          key={child.effectRef}
          child={child}
          wellClass={facetWellClass}
          icon={catalogIcon(child)}
          selected={selectedEffectRef === child.effectRef}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function catalogIcon(child: StoreListChild): ElementHugeIcon {
  const kind = childCatalogKind(child);
  if (kind === "index") return Key01Icon;
  if (kind === "function") return FunctionIcon;
  if (kind === "trigger") return ZapIcon;
  if (kind === "extension") return PuzzleIcon;
  if (kind === "policy") return SecurityCheckIcon;
  return Folder01Icon;
}

/**
 * Open the SQL / KV query console from a facet band.
 *
 * @param props - Facet + active + open
 */
function QueryBandButton({
  facet,
  active,
  onOpen,
}: {
  readonly facet: StoreQueryFacet;
  readonly active: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  const label = facet === "sql" ? "SQL console" : "KV console";
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label={label}
            aria-pressed={active}
            data-slot="store-facet-query"
            data-facet={facet}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick?.(event);
              onOpen();
            }}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              active && "bg-muted text-foreground",
            )}
          >
            <HugeiconsIcon icon={SourceCodeIcon} className="size-3.5" aria-hidden />
          </button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Open the SQL schema visualizer from the SQL facet band.
 *
 * @param props - Active + open
 */
function SchemaBandButton({
  active,
  onOpen,
}: {
  readonly active: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Schema visualizer"
            aria-pressed={active}
            data-slot="store-facet-schema"
            onClick={(event) => {
              event.stopPropagation();
              props.onClick?.(event);
              onOpen();
            }}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              active && "bg-muted text-foreground",
            )}
          >
            <HugeiconsIcon icon={HierarchySquare10Icon} className="size-3.5" aria-hidden />
          </button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        Schema visualizer
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Hide a facet band from the explorer. Restore it from the search-bar menu.
 *
 * @param props - Band label + hide
 */
function FacetVisibilityButton({
  label,
  onHide,
}: {
  readonly label: string;
  readonly onHide: () => void;
}): JSX.Element {
  const action = `Hide ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label={action}
            data-slot="store-facet-visibility"
            onClick={(event) => {
              event.stopPropagation();
              props.onClick?.(event);
              onHide();
            }}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
            )}
          >
            <HugeiconsIcon icon={ViewOffSlashIcon} className="size-3.5" aria-hidden />
          </button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {action}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Chevron well on a facet or store row — reads as the expand control.
 *
 * @param props - Open state + hover group
 */
function TreeChevron({
  open,
  group,
}: {
  readonly open: boolean;
  readonly group: "band" | "store";
}): JSX.Element {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        group === "band"
          ? "group-hover/band:bg-muted/80 group-hover/band:text-foreground"
          : "group-hover/store:bg-muted group-hover/store:text-foreground",
      )}
      aria-hidden
    >
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className={cn("size-3 transition-transform", !open && "-rotate-90")}
      />
    </span>
  );
}

function TableRlsIcon({ enabled }: { readonly enabled: boolean }): JSX.Element {
  const label = enabled ? "RLS enabled" : "RLS disabled";
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            data-slot="store-table-rls"
            data-rls={enabled ? "on" : "off"}
            aria-label={label}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center",
              enabled
                ? "text-emerald-500"
                : "text-muted-foreground/35 group-hover/child:text-amber-600 dark:group-hover/child:text-amber-400",
            )}
          >
            <HugeiconsIcon
              icon={enabled ? ShieldEnergyIcon : ShieldOff}
              className="size-3.5"
              aria-hidden
            />
          </span>
        )}
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One selectable child resource row.
 *
 * @param props - Child + facet chrome + selection
 */
/** Chip for the files driver (`memory` / `fs` / `s3`) with origin tooltip. */
function FilesDriverChip({ driverId }: { readonly driverId: string | undefined }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className="shrink-0 rounded border border-border/50 bg-muted/30 px-1.5 py-px font-mono text-[10px] text-muted-foreground"
            data-slot="files-driver"
          >
            {filesDriverLabel(driverId)}
          </span>
        )}
      />
      <TooltipContent side="right" className="text-[11px]">
        {filesDriverOrigin(driverId)}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One files bucket — the inspectable unit. Singleton stores skip the
 * `attachments → attachments` folder wrap.
 */
function FilesBucketItem({
  store,
  child,
  selected,
  onSelect,
}: {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
  readonly selected: boolean;
  readonly onSelect: (effectRef: string) => void;
}): JSX.Element {
  return (
    <li data-slot="store-files-bucket" data-ref={store.ref}>
      <button
        type="button"
        data-slot="store-child-item"
        data-effect-ref={child.effectRef}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(child.effectRef)}
        className={cn(EXPLORER_ROW_CLASS, "group/child", selected && EXPLORER_ROW_SELECTED_CLASS)}
      >
        <span
          aria-hidden
          className={cn(
            EXPLORER_RAIL_CLASS,
            selected ? EXPLORER_RAIL_ACTIVE_CLASS : "bg-transparent",
          )}
        />
        <span className={cn(EXPLORER_WELL_CLASS, STORE_FACET_SPECS.files.wellClass)} aria-hidden>
          <HugeiconsIcon icon={Folder01Icon} className="size-3" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono transition-colors group-hover/child:text-foreground",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {store.name}
        </span>
        <FilesDriverChip driverId={store.driverId} />
      </button>
    </li>
  );
}

function ChildListItem({
  child,
  wellClass,
  icon,
  selected,
  onSelect,
  hint,
}: {
  readonly child: StoreListChild;
  readonly wellClass: string;
  readonly icon: ElementHugeIcon;
  readonly selected: boolean;
  readonly onSelect: (effectRef: string) => void;
  readonly hint?: string;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        data-slot="store-child-item"
        data-effect-ref={child.effectRef}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(child.effectRef)}
        className={cn(EXPLORER_ROW_CLASS, "group/child", selected && EXPLORER_ROW_SELECTED_CLASS)}
      >
        <span
          aria-hidden
          className={cn(
            EXPLORER_RAIL_CLASS,
            selected ? EXPLORER_RAIL_ACTIVE_CLASS : "bg-transparent",
          )}
        />
        <span className={cn(EXPLORER_WELL_CLASS, wellClass)} aria-hidden>
          <HugeiconsIcon icon={icon} className="size-3" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono transition-colors group-hover/child:text-foreground",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {storeChildLabel(child)}
        </span>
        {hint ? (
          <span className="shrink-0 text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
            {hint}
          </span>
        ) : null}
        {storeChildShowsRls(child) ? <TableRlsIcon enabled={child.rls === true} /> : null}
      </button>
    </li>
  );
}
