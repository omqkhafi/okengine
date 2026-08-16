/**
 * Monitoring page — health strip, aggregated errors, time-series, AI rail.
 */

import { useMemo, useState, type JSX } from "react";
import {
  EXPLORER_PAGE_CLASS,
  EXPLORER_SPLIT,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { cn } from "@/lib/utils.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useConsoleLive } from "@/features/flows/data/use-console-live.ts";
import { useRuns } from "@/features/flows/data/use-runs.ts";
import { TraceDetailSheet } from "@/features/flows/traces/trace-detail-sheet.tsx";
import { useStoresList } from "@/features/store/data/use-stores-list.ts";
import { formatVaultBackend } from "@/features/vault/lib/backend.ts";
import { useVaultList } from "@/features/vault/data/use-vault-list.ts";
import { useAiList } from "./data/use-ai-list.ts";
import { useClockList } from "./data/use-clock-list.ts";
import { useInstancesList } from "./data/use-instances-list.ts";
import { useSignalsList } from "./data/use-signals-list.ts";
import { AiRail } from "./detail/ai-rail.tsx";
import { InstanceFleetSheet } from "./detail/instance-fleet-sheet.tsx";
import { MetricsPanel } from "./detail/metrics-panel.tsx";
import { RunsQueryPanel } from "./query/runs-query-panel.tsx";
import { ErrorList } from "./explorer/error-list.tsx";
import { HealthStrip } from "./explorer/health-strip.tsx";
import { askCountInWindow } from "./lib/ask-count.ts";
import { healthCells } from "./lib/health-cells.ts";
import { timeBuckets } from "./lib/time-buckets.ts";
import { topErrors } from "./lib/top-errors.ts";
import { MONITORING_WINDOWS, windowStatsForRuns } from "./lib/window-stats.ts";
import { useMonitoringSelection } from "./state/monitoring-selection.ts";

/**
 * `/monitoring` — one composition over the persisted runs buffer.
 */
export function MonitoringPage(): JSX.Element {
  const runs = useRuns();
  const liveStatus = useConsoleLive(true);
  const stores = useStoresList();
  const vault = useVaultList();
  const clock = useClockList();
  const fleet = useInstancesList();
  const signals = useSignalsList();
  const ai = useAiList();
  const {
    selectedRunId,
    window,
    selectedErrorKey,
    query,
    view,
    setSelectedRun,
    setWindow,
    setSelectedError,
    setQuery,
    setView,
  } = useMonitoringSelection();
  const [fleetOpen, setFleetOpen] = useState(false);

  const nowMs = Date.now();
  const windowMs = MONITORING_WINDOWS[window];
  const buffer = runs.data ?? [];

  const stats = useMemo(
    () => windowStatsForRuns(buffer, nowMs, windowMs),
    [buffer, nowMs, windowMs],
  );
  const errors = useMemo(() => topErrors(buffer, nowMs, windowMs), [buffer, nowMs, windowMs]);
  const series = useMemo(() => timeBuckets(buffer, nowMs, windowMs), [buffer, nowMs, windowMs]);
  const asks = useMemo(() => askCountInWindow(buffer, nowMs, windowMs), [buffer, nowMs, windowMs]);
  const vaultCard = useMemo(
    () => formatVaultBackend(vault.data?.backend ?? null),
    [vault.data?.backend],
  );
  const cells = useMemo(
    () =>
      healthCells({
        vaultCard,
        stores: stores.data?.stores ?? [],
        runs: buffer,
        crons: clock.data?.crons ?? [],
        signals: signals.data?.signals ?? [],
        window: stats,
        liveStatus,
        fleet: fleet.data,
      }),
    [
      vaultCard,
      stores.data?.stores,
      buffer,
      clock.data?.crons,
      signals.data?.signals,
      stats,
      liveStatus,
      fleet.data,
    ],
  );

  const selectedRun = useMemo(
    () => (selectedRunId ? (buffer.find((run) => run.id === selectedRunId) ?? null) : null),
    [buffer, selectedRunId],
  );

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="monitoring-page">
      <HealthStrip
        cells={cells}
        window={window}
        onWindowChange={setWindow}
        onInstancesClick={() => setFleetOpen(true)}
      />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <ErrorList
              errors={errors}
              query={query}
              selectedErrorKey={selectedErrorKey}
              nowMs={nowMs}
              onQueryChange={setQuery}
              onSelect={(group) => setSelectedError(group.key, group.latestRunId)}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.end.defaultSize}
          minSize={EXPLORER_SPLIT.end.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className={EXPLORER_STRIP_CLASS} role="tablist" aria-label="Monitoring detail">
              <button
                type="button"
                role="tab"
                aria-selected={view === "metrics"}
                className={cn(
                  EXPLORER_STRIP_TOKEN_CLASS,
                  "font-semibold tracking-[0.08em] uppercase",
                  view === "metrics"
                    ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS
                    : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                )}
                onClick={() => setView("metrics")}
                data-slot="monitoring-view-metrics"
              >
                Metrics
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "query"}
                className={cn(
                  EXPLORER_STRIP_TOKEN_CLASS,
                  "font-semibold tracking-[0.08em] uppercase",
                  view === "query"
                    ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS
                    : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                )}
                onClick={() => setView("query")}
                data-slot="monitoring-view-query"
              >
                SQL
              </button>
            </div>
            {view === "query" ? (
              <RunsQueryPanel />
            ) : (
              <>
                <AiRail ai={ai.data} asks={asks} />
                <MetricsPanel series={series} stats={stats} />
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <TraceDetailSheet run={selectedRun} onClose={() => setSelectedRun(null)} />
      <InstanceFleetSheet fleet={fleet.data} open={fleetOpen} onClose={() => setFleetOpen(false)} />
    </div>
  );
}
