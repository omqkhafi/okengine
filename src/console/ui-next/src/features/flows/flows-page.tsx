/**
 * Flow split-view page — Manifest graph (left) + scoped live Traces (right).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useConsoleLive } from "./data/use-console-live.ts";
import { useManifest } from "./data/use-manifest.ts";
import { useRuns } from "./data/use-runs.ts";
import { FlowGraph } from "./graph/flow-graph.tsx";
import { useFlowsSelection } from "./state/flows-selection.ts";
import { graphFilterForNodeId, type GraphFilter } from "./traces/graph-filter.ts";
import {
  activeNodeAt,
  playbackDurationMs,
  playbackNodeSteps,
} from "./traces/replay-playback.ts";
import { scopeRunsToFlows } from "./traces/scope-runs.ts";
import { chainFlowIds } from "./traces/trace-chain.ts";
import { TracesPane } from "./traces/traces-pane.tsx";

/**
 * `/flows` — one composition: structure on the left, activity on the right,
 * linked by shared selection.
 */
export function FlowsPage() {
  const manifest = useManifest();
  const runs = useRuns();
  const liveStatus = useConsoleLive(true);
  const { selectedRunId, follow, setSelectedRun } = useFlowsSelection();

  const [graphFilter, setGraphFilter] = useState<GraphFilter | null>(null);
  const [focusEffectIndex, setFocusEffectIndex] = useState<number | null>(null);
  const [playbackKey, setPlaybackKey] = useState(0);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const visibleFlowIds = useMemo(
    () => new Set(Object.keys(manifest.data?.flows ?? {})),
    [manifest.data],
  );

  const scopedRuns = useMemo(
    () => scopeRunsToFlows(runs.data ?? [], visibleFlowIds),
    [runs.data, visibleFlowIds],
  );

  const highlightedFlowIds = useMemo(
    () => chainFlowIds(runs.data ?? [], selectedRunId),
    [runs.data, selectedRunId],
  );

  // Signal nodes between chain flows (emit → consume) also highlight.
  const highlightedNodeIds = useMemo(() => {
    const out = new Set<string>();
    const flows = manifest.data?.flows ?? {};
    for (const flowId of highlightedFlowIds) {
      const flow = flows[flowId];
      if (!flow) continue;
      for (const sig of flow.effects?.emits ?? []) out.add(`signal:${sig}`);
      if (flow.trigger?.signal) out.add(`signal:${flow.trigger.signal}`);
    }
    return out;
  }, [highlightedFlowIds, manifest.data]);

  const selectedRun = useMemo(
    () => (selectedRunId ? (runs.data?.find((r) => r.id === selectedRunId) ?? null) : null),
    [runs.data, selectedRunId],
  );

  const onGraphNodeClick = useCallback(
    (nodeId: string) => {
      const filter = graphFilterForNodeId(nodeId);
      if (!filter) return;
      setGraphFilter((prev) =>
        prev && prev.kind === filter.kind && JSON.stringify(prev) === JSON.stringify(filter)
          ? null
          : filter,
      );
    },
    [],
  );

  const onGraphPaneClick = useCallback(() => {
    setGraphFilter(null);
  }, []);

  const onReplayStart = useCallback(() => {
    setPlaybackKey((k) => k + 1);
  }, []);

  // Step the graph pulse along the chain while a playback is active.
  useEffect(() => {
    if (playbackKey === 0 || !selectedRun) return;
    const steps = playbackNodeSteps(
      chainFlowIds(runs.data ?? [], selectedRun.id),
      manifest.data ?? null,
    );
    if (steps.length === 0) return;
    const duration = playbackDurationMs(selectedRun.durationMs);
    const startedAt = performance.now();
    setActiveNodeId(steps[0] ?? null);
    playbackTimer.current = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      setActiveNodeId(activeNodeAt(steps, progress));
      if (progress >= 1 && playbackTimer.current) {
        clearInterval(playbackTimer.current);
        playbackTimer.current = null;
        setTimeout(() => setActiveNodeId(null), 400);
      }
    }, 60);
    return () => {
      if (playbackTimer.current) {
        clearInterval(playbackTimer.current);
        playbackTimer.current = null;
      }
      setActiveNodeId(null);
    };
  }, [playbackKey, selectedRun, runs.data, manifest.data]);

  return (
    <div className="flex h-dvh flex-col">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="70%" minSize="30%" className="min-h-0">
          <div className="h-full min-h-0 overflow-hidden">
            <FlowGraph
              manifest={manifest.data ?? null}
              highlightedFlowIds={highlightedFlowIds}
              highlightedNodeIds={highlightedNodeIds}
              follow={follow}
              activeNodeId={activeNodeId}
              onNodeClick={onGraphNodeClick}
              onPaneClick={onGraphPaneClick}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="30%" minSize="240px" maxSize="50%" className="min-h-0">
          <div className="h-full min-h-0 overflow-hidden">
            <TracesPane
              runs={scopedRuns}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRun}
              liveStatus={liveStatus}
              manifest={manifest.data ?? null}
              graphFilter={graphFilter}
              onGraphFilterChange={setGraphFilter}
              focusEffectIndex={focusEffectIndex}
              onFocusEffectChange={setFocusEffectIndex}
              playbackKey={playbackKey}
              onReplayStart={onReplayStart}
              selectedRun={selectedRun}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
