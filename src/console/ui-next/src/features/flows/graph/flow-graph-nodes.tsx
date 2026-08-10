/**
 * Custom React Flow node renderers — icon-forward identity per kind.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ComponentProps, CSSProperties } from "react";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import type { FlowGraphNodeData } from "./build-flow-graph.ts";
import { NODE_ACCENT, type FlowGraphAccentKind } from "./flow-graph-theme.ts";

type GraphNode = Node<FlowGraphNodeData>;
type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

/** Graph leaf kinds use the shared eight-element icon vocabulary. */
const KIND_ICON: Record<FlowGraphAccentKind, HugeIcon> = {
  flow: ELEMENT_ICONS.flow.icon,
  store: ELEMENT_ICONS.store.icon,
  signal: ELEMENT_ICONS.signal.icon,
  ai: ELEMENT_ICONS.ai.icon,
};

const KIND_SHAPE: Record<FlowGraphAccentKind, string> = {
  flow: "rounded-xl",
  store: "rounded-md",
  signal: "rounded-full",
  ai: "rounded-2xl",
};

function shellClass(data: FlowGraphNodeData, kind: FlowGraphAccentKind): string {
  return cn(
    "group relative flex h-full w-full items-center gap-2.5 border-2 px-2.5 text-xs transition-[opacity,filter,box-shadow,border-color,transform] duration-200",
    KIND_SHAPE[kind],
    data.dimmed && "opacity-30 saturate-[0.35]",
    data.highlighted && "z-10 scale-[1.02]",
  );
}

function shellStyle(kind: FlowGraphAccentKind, data: FlowGraphNodeData): CSSProperties {
  const accent = NODE_ACCENT[kind];
  const tint = `color-mix(in oklab, ${accent.accent} 20%, var(--card))`;
  if (data.highlighted) {
    return {
      borderColor: accent.accent,
      background: `color-mix(in oklab, ${accent.accent} 26%, var(--card))`,
      boxShadow: `0 0 0 1px ${accent.accent}, 0 0 22px ${accent.glow}`,
    };
  }
  return {
    borderColor: `color-mix(in oklab, ${accent.accent} 78%, var(--border))`,
    background: tint,
    boxShadow: `inset 3px 0 0 ${accent.accent}`,
  };
}

function IconWell({ kind }: { readonly kind: FlowGraphAccentKind }) {
  const accent = NODE_ACCENT[kind];
  const rounded =
    kind === "signal"
      ? "rounded-full"
      : kind === "store"
        ? "rounded-md"
        : kind === "ai"
          ? "rounded-xl"
          : "rounded-full";
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center border",
        rounded,
      )}
      style={{
        color: accent.accent,
        background: accent.well,
        borderColor: `color-mix(in oklab, ${accent.accent} 55%, transparent)`,
      }}
      aria-hidden
    >
      <HugeiconsIcon icon={KIND_ICON[kind]} size={15} strokeWidth={1.9} />
    </span>
  );
}

function MetaBadge({ text }: { readonly text: string }) {
  return (
    <span className="rounded border border-border/70 bg-background/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
      {text}
    </span>
  );
}

function HandleDot({
  type,
  kind,
}: {
  readonly type: "source" | "target";
  readonly kind: FlowGraphAccentKind;
}) {
  const accent = NODE_ACCENT[kind];
  return (
    <Handle
      type={type}
      position={type === "source" ? Position.Right : Position.Left}
      className="!size-2 !border-0"
      style={{ background: accent.accent }}
    />
  );
}

/** Unit group container (parent node) — sized to content by the layout pass. */
export function UnitNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="h-full w-full rounded-xl border border-dashed border-foreground/25 bg-muted/35 px-3 pt-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {data.label}
        </div>
        {data.badge ? <MetaBadge text={data.badge} /> : null}
      </div>
    </div>
  );
}

/** Flow node — circular icon well + sky accent bar. */
export function FlowNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={shellClass(data, "flow")}
      style={shellStyle("flow", data)}
      data-slot="flow-node"
      data-flow-id={data.refId}
      data-highlighted={data.highlighted ? "true" : "false"}
    >
      <HandleDot type="target" kind="flow" />
      <IconWell kind="flow" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <MetaBadge text={data.badge ?? data.plane ?? "user"} />
        </div>
      </div>
      <HandleDot type="source" kind="flow" />
    </div>
  );
}

/** Store resource node — square icon well + emerald accent. */
export function StoreNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={shellClass(data, "store")}
      style={shellStyle("store", data)}
      data-slot="store-node"
    >
      <HandleDot type="target" kind="store" />
      <IconWell kind="store" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="mt-0.5">
          <MetaBadge text={data.badge ?? data.facet ?? "store"} />
        </div>
      </div>
    </div>
  );
}

/** Signal node — pill shell + amber accent. */
export function SignalNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={shellClass(data, "signal")}
      style={shellStyle("signal", data)}
      data-slot="signal-node"
    >
      <HandleDot type="target" kind="signal" />
      <IconWell kind="signal" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="mt-0.5">
          <MetaBadge text={data.badge ?? "signal"} />
        </div>
      </div>
      <HandleDot type="source" kind="signal" />
    </div>
  );
}

/** AI prompt node — soft rounded shell + rose accent. */
export function AiNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={shellClass(data, "ai")}
      style={shellStyle("ai", data)}
      data-slot="ai-node"
    >
      <HandleDot type="target" kind="ai" />
      <IconWell kind="ai" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="mt-0.5">
          <MetaBadge text={data.badge ?? "ai"} />
        </div>
      </div>
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
