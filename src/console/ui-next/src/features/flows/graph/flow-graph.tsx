/**
 * React Flow canvas — overview map by default, 1-hop neighborhood on focus.
 */

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { useTheme } from "@/components/theme-provider";
import type { OkeElement } from "@/lib/element-icons.ts";
import {
  applyChainHighlight,
  applyEdgeHighlight,
  buildFlowGraph,
  type FlowGraphNode,
} from "./build-flow-graph.ts";
import { applyMapHighlight, buildElementMap } from "./element-map.ts";
import { flowGraphNodeTypes } from "./flow-graph-nodes.tsx";
import { GRAPH_Z, NODE_ACCENT } from "./flow-graph-theme.ts";
import { sliceManifestForFocus, type NeighborhoodFocus } from "./neighborhood.ts";
import type { GraphFilter } from "../traces/graph-filter.ts";
import { graphFilterLabel } from "../traces/graph-filter.ts";

interface FlowGraphProps {
  readonly manifest: Manifest | null;
  readonly runs?: readonly RunRow[];
  readonly graphFilter: GraphFilter | null;
  readonly highlightedFlowIds: ReadonlySet<string>;
  readonly highlightedNodeIds: ReadonlySet<string>;
  /** Whether selection should move the viewport (follow-camera). */
  readonly follow: boolean;
  /** Node id currently pulsing during Replay playback. */
  readonly activeNodeId?: string | null;
  /** Node id emphasized by sticky sheet focus (store / signal / ai). */
  readonly focusedNodeId?: string | null;
  /** Current orchestra note (Overview idle). */
  readonly orchestraLabel?: string | null;
  /** Called when a graph node is clicked. */
  readonly onNodeClick?: (nodeId: string) => void;
  /** Called when the empty canvas is clicked. */
  readonly onPaneClick?: () => void;
}

function neighborhoodFocusOf(filter: GraphFilter | null): NeighborhoodFocus | null {
  if (!filter) return null;
  if (filter.kind === "unit") return filter;
  if (filter.kind === "flow") return filter;
  if (filter.kind === "resource") return filter;
  if (filter.kind === "signal") return { kind: "resource", nodeId: `signal:${filter.signal}` };
  return null;
}

function Canvas({
  manifest,
  runs = [],
  graphFilter,
  highlightedFlowIds,
  highlightedNodeIds,
  follow,
  activeNodeId = null,
  focusedNodeId = null,
  orchestraLabel = null,
  onNodeClick,
  onPaneClick,
}: FlowGraphProps) {
  const { fitView } = useReactFlow();
  const { theme } = useTheme();
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const colorMode =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const neighborhood = neighborhoodFocusOf(graphFilter);
  const isolateElement = graphFilter?.kind === "element" ? graphFilter.element : null;
  const showMap = neighborhood === null;

  const mapGraph = useMemo(
    () =>
      buildElementMap(
        manifest,
        runs,
        isolateElement ? { kind: "element", element: isolateElement } : null,
      ),
    [manifest, runs, isolateElement],
  );

  const detailGraph = useMemo(() => {
    if (!neighborhood || !manifest) return buildFlowGraph(manifest);
    return buildFlowGraph(sliceManifestForFocus(manifest, neighborhood));
  }, [manifest, neighborhood]);

  const mapPainted = useMemo(
    () =>
      applyMapHighlight(mapGraph.nodes, mapGraph.edges, {
        hoverNodeId,
        highlightedFlowIds,
        highlightedNodeIds,
        manifest,
      }),
    [mapGraph.nodes, mapGraph.edges, hoverNodeId, highlightedFlowIds, highlightedNodeIds, manifest],
  );

  const detailNodes = useMemo<FlowGraphNode[]>(
    () =>
      applyChainHighlight(detailGraph.nodes, highlightedFlowIds, highlightedNodeIds, {
        activeNodeId,
        focusedNodeId,
      }),
    [detailGraph.nodes, highlightedFlowIds, highlightedNodeIds, activeNodeId, focusedNodeId],
  );

  const detailEdges = useMemo(
    () => applyEdgeHighlight(detailGraph.edges, detailNodes),
    [detailGraph.edges, detailNodes],
  );

  const nodes = showMap ? mapPainted.nodes : detailNodes;
  const edges = showMap ? mapPainted.edges : detailEdges;

  useEffect(() => {
    void fitView({ duration: 280, padding: 0.18 });
  }, [showMap, graphFilter, manifest, fitView]);

  useEffect(() => {
    if (!follow || showMap) return;
    if (highlightedFlowIds.size === 0) return;
    const ids = [...highlightedFlowIds].map((f) => `flow:${f}`);
    void fitView({ nodes: ids.map((id) => ({ id })), duration: 300, padding: 0.2 });
  }, [follow, showMap, highlightedFlowIds, fitView]);

  return (
    <div className="relative h-full w-full">
      {graphFilter ? (
        <button
          type="button"
          data-slot="flow-graph-map"
          onClick={() => onPaneClick?.()}
          className="absolute top-2 left-2 z-10 inline-flex max-w-[min(100%-1rem,20rem)] items-center gap-1.5 truncate rounded-md border border-border/70 bg-card/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-border hover:text-foreground"
        >
          <span className="text-foreground">Map</span>
          <span aria-hidden>/</span>
          <span className="truncate">{graphFilterLabel(graphFilter)}</span>
        </button>
      ) : (
        <div className="pointer-events-none absolute top-2 left-2 z-10 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {orchestraLabel ? (
            <>
              Orchestra <span className="text-foreground normal-case">{orchestraLabel}</span>
            </>
          ) : (
            "Hover a unit — spokes light the elements it touches"
          )}
        </div>
      )}
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
        minZoom={0.15}
        maxZoom={1.6}
        defaultEdgeOptions={{ type: "smoothstep", zIndex: GRAPH_Z.edge }}
        zIndexMode="manual"
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        onPaneClick={() => onPaneClick?.()}
        onNodeMouseEnter={(_, node) => setHoverNodeId(node.id)}
        onNodeMouseLeave={() => setHoverNodeId(null)}
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
          ariaLabel="Flow graph overview"
          bgColor="var(--card)"
          maskColor="color-mix(in oklab, var(--background) 55%, transparent)"
          nodeColor={minimapNodeColor}
          nodeStrokeColor={minimapNodeStroke}
          nodeStrokeWidth={12}
          nodeBorderRadius={10}
        />
      </ReactFlow>
    </div>
  );
}

/**
 * MiniMap swatch from the same accents as the canvas nodes.
 *
 * @param node - Flow graph node
 */
function minimapNodeColor(node: FlowGraphNode): string {
  if (node.type === "orbit") return "transparent";
  const kind = node.data.kind;
  if (kind === "law") {
    return "color-mix(in oklab, var(--foreground) 45%, transparent)";
  }
  if (kind === "unit") {
    return "color-mix(in oklab, var(--foreground) 8%, transparent)";
  }
  if (kind === "element") {
    const element = node.data.refId as OkeElement;
    return NODE_ACCENT[element]?.accent ?? "#64748B";
  }
  if (kind in NODE_ACCENT) {
    return NODE_ACCENT[kind as OkeElement].accent;
  }
  return "#64748B";
}

/**
 * MiniMap outline — unit groups as a faint frame; leaves stay fill-only.
 *
 * @param node - Flow graph node
 */
function minimapNodeStroke(node: FlowGraphNode): string {
  if (node.data.kind === "unit") {
    return "color-mix(in oklab, var(--foreground) 32%, transparent)";
  }
  return "transparent";
}

/**
 * Flow graph pane — eight-element map, then a neighborhood on focus.
 *
 * @param props - Manifest, runs, highlight sets, follow-camera flag
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
