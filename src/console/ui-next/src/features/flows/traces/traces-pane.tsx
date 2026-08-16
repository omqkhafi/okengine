/**
 * Scoped Traces pane (start side of the Flow split-view).
 */

import { useEffect, useMemo, useState } from "react";
import { Alert02Icon, FilterHorizontalIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import {
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  EXPLORER_TOOLBAR_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { ExplorerSearch } from "@/components/explorer/explorer-search.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import type { LiveStatus } from "../data/use-console-live.ts";
import { AdvancedFilters } from "./advanced-filters.tsx";
import type { DimensionQuery } from "./dimension-query.ts";
import {
  applyGraphFilterToQuery,
  filterRunsByGraph,
  graphFilterLabel,
  type GraphFilter,
} from "./graph-filter.ts";
import {
  DEFAULT_TRACES_FILTERS,
  filterScopedRuns,
  type TracesFilters,
  type TracesStatusFilter,
} from "./filter-runs.ts";
import { TraceDetailSheet } from "./trace-detail-sheet.tsx";
import { TraceRow } from "./trace-row.tsx";

const STATUS_FILTERS = [
  { value: "all" as const, label: "All", icon: Menu01Icon },
  { value: "errors" as const, label: "Errors", icon: Alert02Icon },
];

/**
 * Trace list scoped to flows visible on the graph.
 *
 * @param props - Scoped runs, selection, live status
 */
export function TracesPane({
  runs,
  selectedRunId,
  onSelect,
  liveStatus,
  manifest,
  graphFilter,
  onGraphFilterChange,
  focusEffectIndex,
  onFocusEffectChange,
  playbackKey,
  onReplayStart,
  selectedRun: selectedRunProp,
}: {
  readonly runs: readonly RunRow[];
  readonly selectedRunId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly liveStatus: LiveStatus;
  readonly manifest: Manifest | null;
  readonly graphFilter: GraphFilter | null;
  readonly onGraphFilterChange: (filter: GraphFilter | null) => void;
  readonly focusEffectIndex: number | null;
  readonly onFocusEffectChange: (index: number | null) => void;
  readonly playbackKey: number;
  readonly onReplayStart: () => void;
  readonly selectedRun?: RunRow | null;
}) {
  const [filters, setFilters] = useState<TracesFilters>(DEFAULT_TRACES_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Graph flow / unit clicks upsert a dimension clause into the shared query.
  useEffect(() => {
    if (graphFilter?.kind === "flow" || graphFilter?.kind === "unit") {
      setFilters((prev) => ({
        ...prev,
        advanced: applyGraphFilterToQuery(prev.advanced, graphFilter),
      }));
    }
  }, [graphFilter]);

  const visible = useMemo(() => {
    const base = filterScopedRuns(runs, filters);
    return filterRunsByGraph(base, graphFilter, manifest);
  }, [runs, filters, graphFilter, manifest]);

  const selectedRun = useMemo(
    () =>
      selectedRunProp !== undefined
        ? selectedRunProp
        : selectedRunId
          ? (runs.find((r) => r.id === selectedRunId) ?? null)
          : null,
    [selectedRunProp, runs, selectedRunId],
  );
  const advancedActive = filters.advanced.clauses.length > 0;

  const setQuery = (query: string) => {
    setFilters((prev) => ({ ...prev, query }));
  };

  const setStatus = (status: TracesStatusFilter) => {
    setFilters((prev) => ({ ...prev, status }));
  };

  const setAdvanced = (advanced: DimensionQuery) => {
    setFilters((prev) => ({ ...prev, advanced }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="traces-pane">
      <div className="shrink-0 border-b border-border/60">
        <div className={cn(EXPLORER_TOOLBAR_CLASS, "border-b-0")}>
          <ExplorerSearch
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search traces…"
            aria-label="Search traces"
            data-slot="traces-search"
          />
          <div className="flex shrink-0 items-stretch pr-0.5">
            {runs.length > 0 ? (
              <Tooltip>
                <TooltipTrigger
                  render={(props) => (
                    <button
                      {...props}
                      type="button"
                      aria-expanded={advancedOpen}
                      aria-controls="traces-advanced-panel"
                      aria-label={
                        advancedActive
                          ? `Advanced filters, ${filters.advanced.clauses.length} active`
                          : "Advanced filters"
                      }
                      data-slot="traces-advanced-toggle"
                      onClick={(event) => {
                        props.onClick?.(event);
                        setAdvancedOpen((open) => !open);
                      }}
                      className={cn(
                        EXPLORER_ICON_BUTTON_CLASS,
                        "relative",
                        (advancedOpen || advancedActive) && EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
                      )}
                    >
                      <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3" aria-hidden />
                      {advancedActive ? (
                        <span
                          className="absolute -top-0.5 -inset-e-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[8px] font-medium text-background"
                          aria-hidden
                        >
                          {filters.advanced.clauses.length}
                        </span>
                      ) : null}
                    </button>
                  )}
                />
                <TooltipContent side="bottom">Advanced</TooltipContent>
              </Tooltip>
            ) : null}
            {runs.length > 0 ? <span className="mx-0.5 h-3 w-px bg-border/60" aria-hidden /> : null}
            <div className="flex items-center gap-1.5 pr-0.5 text-[10px] text-muted-foreground">
              <span
                className={
                  liveStatus === "open"
                    ? "size-1.5 rounded-full bg-emerald-500"
                    : "size-1.5 rounded-full bg-muted-foreground"
                }
                aria-hidden
              />
              {liveStatus === "open" ? "live" : "polling"}
            </div>
          </div>
        </div>

        {runs.length > 0 ? (
          <div
            className={cn(EXPLORER_STRIP_CLASS, "border-t border-b-0")}
            data-slot="traces-filters"
          >
            <div className="flex shrink-0 items-stretch" role="group" aria-label="Status filter">
              {STATUS_FILTERS.map(({ value, label, icon }) => {
                const active = filters.status === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatus(value)}
                    className={cn(
                      EXPLORER_STRIP_TOKEN_CLASS,
                      "font-semibold tracking-[0.08em] uppercase",
                      active
                        ? value === "errors"
                          ? "text-destructive"
                          : EXPLORER_STRIP_TOKEN_ACTIVE_CLASS
                        : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                    )}
                  >
                    <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {runs.length > 0 && graphFilter ? (
          <button
            type="button"
            data-slot="traces-graph-filter"
            onClick={() => onGraphFilterChange(null)}
            title="Clear graph filter"
            className="mx-2 mb-1.5 inline-flex max-w-full items-center gap-1 self-start truncate rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
          >
            <span className="truncate">{graphFilterLabel(graphFilter)}</span>
            <span aria-hidden>×</span>
          </button>
        ) : null}
      </div>

      {runs.length > 0 && advancedOpen ? (
        <div id="traces-advanced-panel">
          <AdvancedFilters query={filters.advanced} runs={runs} onChange={setAdvanced} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {runs.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={ELEMENT_ICONS.flow.icon} />
              </EmptyMedia>
              <EmptyTitle>No traces yet</EmptyTitle>
              <EmptyDescription>
                No runs for the flows on this graph yet. Trigger a flow to see live activity here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyTitle>No matching traces</EmptyTitle>
              <EmptyDescription>
                Nothing in this list matches the current search, status, or advanced filters.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visible.map((run) => (
            <TraceRow
              key={run.id}
              run={run}
              selected={run.id === selectedRunId}
              onSelect={(id) => onSelect(id === selectedRunId ? null : id)}
            />
          ))
        )}
      </div>

      <TraceDetailSheet
        run={selectedRun}
        onClose={() => onSelect(null)}
        focusEffectIndex={focusEffectIndex}
        onFocusEffectChange={onFocusEffectChange}
        playbackKey={playbackKey}
        onReplayStart={onReplayStart}
      />
    </div>
  );
}
