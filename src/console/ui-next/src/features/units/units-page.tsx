/**
 * Flows page — Manifest service catalog + docked Call API.
 */

import { useMemo, type JSX } from "react";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { ExplorerStartToggle } from "@/components/explorer/explorer-start-toggle.tsx";
import { EXPLORER_PAGE_CLASS, EXPLORER_SPLIT } from "@/components/explorer/explorer-chrome.ts";
import { useExplorerStartPanel } from "@/components/explorer/use-explorer-start-panel.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { useConsoleLive } from "@/features/flows/data/use-console-live.ts";
import { useManifest } from "@/features/flows/data/use-manifest.ts";
import { useRuns } from "@/features/flows/data/use-runs.ts";
import { CallApiPanel } from "./call/call-api-panel.tsx";
import { FlowContractPanel } from "./detail/flow-contract-panel.tsx";
import { UnitsTree } from "./explorer/units-tree.tsx";
import { buildUnitTree } from "./lib/unit-tree.ts";
import { useUnitsSelection } from "./state/units-selection.ts";

/**
 * Flows explorer page.
 */
export function UnitsPage(): JSX.Element {
  const manifestQuery = useManifest();
  const runs = useRuns();
  useConsoleLive(true);
  const { selectedFlowId: urlFlowId, setSelectedFlow } = useUnitsSelection();
  const start = useExplorerStartPanel();
  const groups = useMemo(() => buildUnitTree(manifestQuery.data ?? null), [manifestQuery.data]);
  const startToggle = (
    <ExplorerStartToggle
      open={start.open}
      onToggle={start.toggle}
      noun="flows"
      controlsId="flows-tree"
      dataSlot="flows-tree-toggle"
    />
  );

  const selectedFlowId = urlFlowId ?? groups[0]?.flows[0]?.id ?? null;
  const selectedRow = useMemo(() => {
    if (!selectedFlowId) return null;
    for (const g of groups) {
      const hit = g.flows.find((f) => f.id === selectedFlowId);
      if (hit) return hit;
    }
    return null;
  }, [groups, selectedFlowId]);

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="units-page">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          panelRef={start.panelRef}
          collapsible
          collapsedSize={0}
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          onResize={start.onResize}
          className="min-h-0 overflow-hidden"
        >
          <div id="flows-tree" className="h-full min-h-0 overflow-hidden" data-slot="flows-tree">
            <UnitsTree
              groups={groups}
              selectedFlowId={selectedFlowId}
              onSelect={(flowId) => {
                setSelectedFlow(flowId);
              }}
            />
          </div>
        </ResizablePanel>
        {start.open ? <ResizableHandle withHandle /> : null}
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.end.defaultSize}
          minSize={EXPLORER_SPLIT.end.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="h-full min-h-0 overflow-hidden">
            {selectedRow ? (
              <ResizablePanelGroup
                orientation="vertical"
                className="min-h-0 flex-1"
                data-slot="units-inspector"
              >
                <ResizablePanel defaultSize="56%" minSize="28%" className="min-h-0 overflow-hidden">
                  <FlowContractPanel
                    row={selectedRow}
                    manifest={manifestQuery.data ?? null}
                    runs={runs.data}
                    leading={startToggle}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  defaultSize="44%"
                  minSize="220px"
                  className="min-h-0 overflow-hidden"
                >
                  <CallApiPanel row={selectedRow} manifest={manifestQuery.data ?? null} />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <ExplorerEmpty
                icon={ELEMENT_ICONS.flow.icon}
                title={manifestQuery.isLoading ? "Loading Manifest…" : "Select a flow"}
                description={
                  manifestQuery.isLoading
                    ? "Reading the derived Manifest."
                    : "Pick a flow from the tree to inspect its contract."
                }
                leading={startToggle}
              />
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
