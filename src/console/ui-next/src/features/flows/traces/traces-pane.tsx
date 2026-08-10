/**
 * Scoped Traces pane (right side of the Flow split-view).
 */

import { useMemo, useState } from "react";
import {
  AlertCircleIcon,
  FilterHorizontalIcon,
  Menu01Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RunRow } from "@/client.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import type { LiveStatus } from "../data/use-console-live.ts";
import { AdvancedFilters } from "./advanced-filters.tsx";
import type { DimensionQuery } from "./dimension-query.ts";
import {
  DEFAULT_TRACES_FILTERS,
  durationThresholdLabel,
  filterScopedRuns,
  type TracesDurationThresholdMs,
  type TracesFilters,
  type TracesStatusFilter,
} from "./filter-runs.ts";
import { TraceRow } from "./trace-row.tsx";

const DURATION_OPTIONS: readonly TracesDurationThresholdMs[] = [null, 10, 100, 1_000];

const STATUS_FILTERS = [
  { value: "all" as const, label: "All", icon: Menu01Icon },
  { value: "errors" as const, label: "Errors", icon: AlertCircleIcon },
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
}: {
  readonly runs: readonly RunRow[];
  readonly selectedRunId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly liveStatus: LiveStatus;
}) {
  const [filters, setFilters] = useState<TracesFilters>(DEFAULT_TRACES_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const visible = useMemo(() => filterScopedRuns(runs, filters), [runs, filters]);
  const advancedActive = filters.advanced.clauses.length > 0;

  const setStatus = (status: TracesStatusFilter) => {
    setFilters((prev) => ({ ...prev, status }));
  };

  const setMinDuration = (minDurationMs: TracesDurationThresholdMs) => {
    setFilters((prev) => ({ ...prev, minDurationMs }));
  };

  const setAdvanced = (advanced: DimensionQuery) => {
    setFilters((prev) => ({ ...prev, advanced }));
  };

  return (
    <div className="flex h-full flex-col" data-slot="traces-pane">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <HugeiconsIcon
            icon={ELEMENT_ICONS.flow.icon}
            className="size-3.5 text-muted-foreground"
          />
          Traces
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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

      {runs.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5"
          data-slot="traces-filters"
        >
          <div
            className="inline-flex rounded-md bg-muted/60 p-0.5"
            role="group"
            aria-label="Status filter"
          >
            {STATUS_FILTERS.map(({ value, label, icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.status === value}
                onClick={() => setStatus(value)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10px] font-medium transition-colors",
                  filters.status === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <label className="relative flex items-center text-[10px] text-muted-foreground">
            <span className="sr-only">Duration threshold</span>
            <HugeiconsIcon
              icon={Timer01Icon}
              className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground"
              aria-hidden
            />
            <select
              aria-label="Duration threshold"
              className="h-6 max-w-[8.5rem] rounded-md border border-border/70 bg-transparent py-0 pr-1.5 pl-6 text-[10px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              value={filters.minDurationMs === null ? "" : String(filters.minDurationMs)}
              onChange={(e) => {
                const raw = e.target.value;
                setMinDuration(raw === "" ? null : (Number(raw) as TracesDurationThresholdMs));
              }}
            >
              {DURATION_OPTIONS.map((ms) => (
                <option key={ms === null ? "any" : ms} value={ms === null ? "" : String(ms)}>
                  {durationThresholdLabel(ms)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="traces-advanced-panel"
            data-slot="traces-advanced-toggle"
            onClick={() => setAdvancedOpen((open) => !open)}
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
              advancedOpen || advancedActive
                ? "border-foreground/25 bg-background text-foreground shadow-sm"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={FilterHorizontalIcon} className="size-3" aria-hidden />
            Advanced
            {advancedActive ? (
              <span className="tabular-nums text-muted-foreground">
                {filters.advanced.clauses.length}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

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
                Nothing in this list matches the current status, duration, or advanced filters.
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
    </div>
  );
}
