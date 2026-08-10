/**
 * React Flow canvas for the Flow graph (left pane).
 */

import { Background, Controls, ReactFlow, useReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { useTheme } from "@/components/theme-provider";
import {
  applyChainHighlight,
  buildFlowGraph,
  type FlowGraphNode,
} from "./build-flow-graph.ts";
import { flowGraphNodeTypes } from "./flow-graph-nodes.tsx";

interface FlowGraphProps {
  readonly manifest: Manifest | null;
  readonly highlightedFlowIds: ReadonlySet<string>;
  readonly highlightedNodeIds: ReadonlySet<string>;
  /** Whether selection should move the viewport (follow-camera). */
  readonly follow: boolean;
}

function Canvas({ manifest, highlightedFlowIds, highlightedNodeIds, follow }: FlowGraphProps) {
  const { fitView } = useReactFlow();
  const { theme } = useTheme();
  const colorMode =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const graph = useMemo(() => buildFlowGraph(manifest), [manifest]);

  const nodes = useMemo<FlowGraphNode[]>(
    () => applyChainHighlight(graph.nodes, highlightedFlowIds, highlightedNodeIds),
    [graph.nodes, highlightedFlowIds, highlightedNodeIds],
  );

  // Follow-camera: zoom to the highlighted chain when enabled.
  useEffect(() => {
    if (!follow) return;
    if (highlightedFlowIds.size === 0) return;
    const ids = [...highlightedFlowIds].map((f) => `flow:${f}`);
    fitView({ nodes: ids.map((id) => ({ id })), duration: 300, padding: 0.2 });
  }, [follow, highlightedFlowIds, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={graph.edges}
      nodeTypes={flowGraphNodeTypes}
      colorMode={colorMode}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.6}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/**
 * Flow graph pane — Manifest structure as a node canvas.
 *
 * @param props - Manifest, highlight sets, follow-camera flag
 */
export function FlowGraph(props: FlowGraphProps) {
  return (
    <div className="h-full w-full" data-slot="flow-graph">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
