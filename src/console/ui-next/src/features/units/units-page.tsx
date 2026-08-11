/**
 * Units page — Manifest service catalog + Call API.
 */

import { useMemo, type JSX } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useManifest } from "@/features/flows/data/use-manifest.ts";
import { CallApiPanel } from "./call/call-api-panel.tsx";
import { FlowContractPanel } from "./detail/flow-contract-panel.tsx";
import { UnitsTree } from "./explorer/units-tree.tsx";
import { buildUnitTree } from "./lib/unit-tree.ts";
import { useUnitsSelection } from "./state/units-selection.ts";

/**
 * Units explorer page.
 */
export function UnitsPage(): JSX.Element {
  const manifestQuery = useManifest();
  const { selectedFlowId: urlFlowId, setSelectedFlow } = useUnitsSelection();
  const groups = useMemo(
    () => buildUnitTree(manifestQuery.data ?? null),
    [manifestQuery.data],
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
    <div className="flex h-dvh flex-col" data-slot="units-page">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="28%" minSize="18%" className="min-h-0">
          <UnitsTree
            groups={groups}
            selectedFlowId={selectedFlowId}
            onSelect={(flowId) => {
              setSelectedFlow(flowId);
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="72%" minSize="40%" className="min-h-0">
          <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            {selectedRow ? (
              <>
                <FlowContractPanel
                  row={selectedRow}
                  manifest={manifestQuery.data ?? null}
                />
                <CallApiPanel row={selectedRow} />
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {manifestQuery.isLoading
                  ? "Loading Manifest…"
                  : "Select a flow from the Units tree."}
              </p>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
