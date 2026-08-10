/**
 * Custom React Flow node renderers for the Flow graph.
 */

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { FlowGraphNodeData } from "./build-flow-graph.ts";

type GraphNode = Node<FlowGraphNodeData>;

function shell(data: FlowGraphNodeData, extra?: string): string {
  return cn(
    "rounded-md border px-3 py-2 text-xs transition-opacity",
    data.dimmed && "opacity-30",
    data.highlighted && "ring-2 ring-primary border-primary",
    extra,
  );
}

/** Unit group container (parent node). */
export function UnitNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="h-full w-full rounded-lg border border-dashed bg-muted/30 px-2 py-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {data.label}
      </div>
    </div>
  );
}

/** Flow node. */
export function FlowNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={shell(data, "bg-card")}
      data-slot="flow-node"
      data-flow-id={data.refId}
      data-highlighted={data.highlighted ? "true" : "false"}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5" />
      <div className="font-medium text-foreground">{data.label}</div>
      <div className="text-[10px] text-muted-foreground">{data.plane}</div>
      <Handle type="source" position={Position.Right} className="!size-1.5" />
    </div>
  );
}

/** Store resource node (sql / kv / files / index). */
export function StoreNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className={shell(data, "bg-secondary")}>
      <Handle type="target" position={Position.Left} className="!size-1.5" />
      <div className="font-medium text-secondary-foreground">{data.label}</div>
      <div className="text-[10px] text-muted-foreground">{data.facet}</div>
    </div>
  );
}

/** Signal node. */
export function SignalNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className={shell(data, "bg-accent")}>
      <Handle type="target" position={Position.Left} className="!size-1.5" />
      <div className="font-medium text-accent-foreground">{data.label}</div>
      <div className="text-[10px] text-muted-foreground">signal</div>
      <Handle type="source" position={Position.Right} className="!size-1.5" />
    </div>
  );
}

/** AI prompt node. */
export function AiNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className={shell(data, "bg-muted")}>
      <Handle type="target" position={Position.Left} className="!size-1.5" />
      <div className="font-medium text-foreground">{data.label}</div>
      <div className="text-[10px] text-muted-foreground">ai</div>
    </div>
  );
}

/** nodeTypes registry for `<ReactFlow>`. */
export const flowGraphNodeTypes = {
  unit: UnitNode,
  flow: FlowNode,
  store: StoreNode,
  signal: SignalNode,
  ai: AiNode,
};
