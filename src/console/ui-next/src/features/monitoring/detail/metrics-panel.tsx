/**
 * Time-series inspector — window KPIs + one Bklit composed chart.
 */

import { Activity03Icon } from "@hugeicons/core-free-icons";
import type { JSX } from "react";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { DETAIL_HEADER_CLASS, DETAIL_TITLE_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { durationTone, durationToneClass } from "@/features/flows/traces/duration-tone.ts";
import { cn } from "@/lib/utils.ts";
import { composedSeriesFromBuckets, type TimeBuckets } from "../lib/time-buckets.ts";
import type { WindowStats } from "../lib/window-stats.ts";
import { MetricsChart, MONITORING_SERIES } from "./metrics-chart.tsx";

/** Props for {@link MetricsPanel}. */
export interface MetricsPanelProps {
  readonly series: TimeBuckets;
  readonly stats: WindowStats;
}

/**
 * Right-pane KPIs + composed chart. Honest empty when the window has no runs.
 *
 * @param props - Bucketed series + window totals
 */
export function MetricsPanel({ series, stats }: MetricsPanelProps): JSX.Element {
  if (series.kind === "empty" || stats.kind === "empty") {
    return (
      <ExplorerEmpty
        icon={Activity03Icon}
        title="No runs in this window"
        description="The Console buffer has no traces for the selected lookback. Numbers stay empty — they are not zero."
      />
    );
  }

  const data = composedSeriesFromBuckets(series.buckets);
  const errorPct = Math.round(stats.errorRate * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-slot="monitoring-metrics">
      <header className={DETAIL_HEADER_CLASS}>
        <h2 className={DETAIL_TITLE_CLASS}>Metrics</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {series.buckets.length} buckets
        </span>
      </header>
      <div
        className="grid shrink-0 grid-cols-4 border-b border-border/60"
        data-slot="monitoring-kpis"
      >
        <Kpi label="Runs" value={String(stats.total)} />
        <Kpi
          label="Errors"
          meta={`${errorPct}%`}
          tone={stats.errors > 0 ? "warn" : "ok"}
          value={String(stats.errors)}
        />
        <Kpi
          label="P95"
          toneClassName={durationToneClass(durationTone(stats.p95Ms))}
          value={formatDuration(stats.p95Ms)}
        />
        <Kpi
          label="P50"
          toneClassName={durationToneClass(durationTone(stats.p50Ms))}
          value={formatDuration(stats.p50Ms)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 px-3 pt-3" data-slot="monitoring-legend">
          <LegendSwatch
            color={MONITORING_SERIES.requests.color}
            label={MONITORING_SERIES.requests.label}
            shape="bar"
          />
          <LegendSwatch
            color={MONITORING_SERIES.errors.color}
            label={MONITORING_SERIES.errors.label}
            shape="line"
          />
          <LegendSwatch
            color={MONITORING_SERIES.p95.color}
            label={`${MONITORING_SERIES.p95.label} · right`}
            shape="area"
          />
        </div>
        <div className="px-1 pb-2" data-slot="monitoring-chart">
          <MetricsChart data={data} />
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  meta,
  tone,
  toneClassName,
}: {
  readonly label: string;
  readonly value: string;
  readonly meta?: string;
  readonly tone?: "ok" | "warn";
  readonly toneClassName?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 border-r border-border/50 px-3 py-2.5 last:border-r-0">
      <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-lg leading-none font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-destructive",
          tone === "ok" && "text-foreground",
          toneClassName,
        )}
      >
        {value}
        {meta ? (
          <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">{meta}</span>
        ) : null}
      </span>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  shape,
}: {
  readonly color: string;
  readonly label: string;
  readonly shape: "bar" | "line" | "area";
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "shrink-0",
          shape === "bar" && "h-2 w-2 rounded-[2px]",
          shape === "line" && "h-0.5 w-3 rounded-full",
          shape === "area" && "h-2 w-2.5 rounded-sm opacity-70",
        )}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
