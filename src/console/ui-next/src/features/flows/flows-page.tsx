/**
 * Flow split-view page — Manifest graph (left) + scoped live Traces (right).
 */

import { useMemo } from "react";
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
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
