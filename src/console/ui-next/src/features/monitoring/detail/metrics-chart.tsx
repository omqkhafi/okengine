/**
 * Bklit composed chart — request volume, error count, and P95 on one plot.
 */

import { Area } from "@/components/charts/area.tsx";
import { ComposedChart } from "@/components/charts/composed-chart.tsx";
import { Grid } from "@/components/charts/grid.tsx";
import { Line } from "@/components/charts/line.tsx";
import { SeriesBar } from "@/components/charts/series-bar.tsx";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip.tsx";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content.tsx";
import { XAxis } from "@/components/charts/x-axis.tsx";
import { YAxis } from "@/components/charts/y-axis.tsx";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import type { JSX } from "react";
import type { MonitoringChartRow } from "../lib/time-buckets.ts";

/** Series ink — sky volume, rose errors, teal latency. */
export const MONITORING_SERIES = {
  requests: { key: "requests", label: "Requests", color: "var(--chart-1)" },
  errors: { key: "errors", label: "Errors", color: "var(--destructive)" },
  p95: { key: "p95", label: "P95", color: "var(--chart-2)" },
} as const;

/** Props for {@link MetricsChart}. */
export interface MetricsChartProps {
  readonly data: readonly MonitoringChartRow[];
}

/**
 * Dual-axis composed chart. Parent must give the box a width.
 *
 * @param props - Bucket rows
 */
export function MetricsChart({ data }: MetricsChartProps): JSX.Element {
  const rows: Record<string, unknown>[] = data.map((row) => ({
    date: row.date,
    requests: row.requests,
    errors: row.errors,
    p95: row.p95,
  }));
  return (
    <ComposedChart
      aspectRatio="16 / 7"
      barGap={0}
      className="min-h-[240px]"
      data={rows}
      margin={{ top: 12, right: 44, bottom: 28, left: 36 }}
      maxBarSize={16}
      xDataKey="date"
    >
      <Grid horizontal numTicksRows={4} />
      <SeriesBar
        dataKey={MONITORING_SERIES.requests.key}
        fill={MONITORING_SERIES.requests.color}
        radius={2}
      />
      <Line
        dataKey={MONITORING_SERIES.errors.key}
        showMarkers={false}
        stroke={MONITORING_SERIES.errors.color}
        strokeWidth={2}
      />
      <Area
        dataKey={MONITORING_SERIES.p95.key}
        fadeEdges
        fill={MONITORING_SERIES.p95.color}
        fillOpacity={0.28}
        showMarkers={false}
        strokeWidth={2}
        yAxisId="right"
      />
      <YAxis formatLargeNumbers={false} numTicks={4} />
      <YAxis
        formatValue={(value) => formatDuration(value)}
        numTicks={4}
        orientation="right"
        yAxisId="right"
      />
      <XAxis numTicks={6} />
      <ChartTooltip rows={tooltipRows} showCrosshair />
    </ComposedChart>
  );
}

function tooltipRows(point: Record<string, unknown>): TooltipRow[] {
  const requests = numeric(point.requests);
  const errors = numeric(point.errors);
  const p95 = numeric(point.p95);
  return [
    {
      color: MONITORING_SERIES.requests.color,
      label: MONITORING_SERIES.requests.label,
      value: requests,
    },
    {
      color: MONITORING_SERIES.errors.color,
      label: MONITORING_SERIES.errors.label,
      value: errors,
    },
    {
      color: MONITORING_SERIES.p95.color,
      label: MONITORING_SERIES.p95.label,
      value: formatDuration(p95),
    },
  ];
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
