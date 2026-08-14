/**
 * React Flow canvas for the Flow graph (left pane).
 */

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { useTheme } from "@/components/theme-provider";
import {
  applyChainHighlight,
  applyEdgeHighlight,
  buildFlowGraph,
  type FlowGraphNode,
} from "./build-flow-graph.ts";
import { flowGraphNodeTypes } from "./flow-graph-nodes.tsx";
import { NODE_ACCENT } from "./flow-graph-theme.ts";

interface FlowGraphProps {
  readonly manifest: Manifest | null;
  readonly highlightedFlowIds: ReadonlySet<string>;
  readonly highlightedNodeIds: ReadonlySet<string>;
  /** Whether selection should move the viewport (follow-camera). */
  readonly follow: boolean;
  /** Node id currently pulsing during Replay playback. */
  readonly activeNodeId?: string | null;
  /** Node id emphasized by sticky sheet focus (store / signal / ai). */
  readonly focusedNodeId?: string | null;
  /** Called when a graph node is clicked. */
  readonly onNodeClick?: (nodeId: string) => void;
  /** Called when the empty canvas is clicked. */
  readonly onPaneClick?: () => void;
}

function Canvas({
  manifest,
  highlightedFlowIds,
  highlightedNodeIds,
  follow,
  activeNodeId = null,
  focusedNodeId = null,
  onNodeClick,
  onPaneClick,
}: FlowGraphProps) {
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
    () =>
      applyChainHighlight(graph.nodes, highlightedFlowIds, highlightedNodeIds, {
        activeNodeId,
        focusedNodeId,
      }),
    [graph.nodes, highlightedFlowIds, highlightedNodeIds, activeNodeId, focusedNodeId],
  );

  const edges = useMemo(() => applyEdgeHighlight(graph.edges, nodes), [graph.edges, nodes]);

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
      edges={edges}
      nodeTypes={flowGraphNodeTypes}
      colorMode={colorMode}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.6}
      defaultEdgeOptions={{ type: "smoothstep" }}
      onNodeClick={(_, node) => onNodeClick?.(node.id)}
      onPaneClick={() => onPaneClick?.()}
    >
      <Background
        gap={24}
        size={1}
        color="color-mix(in oklab, var(--foreground) 14%, transparent)"
      />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="color-mix(in oklab, var(--background) 72%, transparent)"
        nodeColor={minimapNodeColor}
        aria-label="Flow graph overview"
      />
    </ReactFlow>
  );
}

/**
 * MiniMap swatch from the same accents as the canvas nodes.
 *
 * @param node - Flow graph node
 */
function minimapNodeColor(node: FlowGraphNode): string {
  const kind = node.data.kind;
  if (kind === "flow" || kind === "store" || kind === "signal" || kind === "ai") {
    return NODE_ACCENT[kind].accent;
  }
  return "color-mix(in oklab, var(--foreground) 22%, transparent)";
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
