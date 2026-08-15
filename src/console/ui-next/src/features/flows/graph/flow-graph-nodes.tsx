/**
 * Custom React Flow node renderers — icon-forward identity per kind.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { OkeLogo } from "@/components/oke-logo.tsx";
import { motion, useReducedMotion } from "@/lib/motion";
import { ELEMENT_ICONS, type OkeElement } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils";
import type { FlowGraphNodeData } from "./build-flow-graph.ts";
import { NODE_ACCENT, type FlowGraphAccentKind } from "./flow-graph-theme.ts";

type GraphNode = Node<FlowGraphNodeData>;
type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

/** Graph leaf kinds use the shared eight-element icon vocabulary. */
const KIND_ICON: Record<FlowGraphAccentKind, HugeIcon> = {
  flow: ELEMENT_ICONS.flow.icon,
  signal: ELEMENT_ICONS.signal.icon,
  store: ELEMENT_ICONS.store.icon,
  clock: ELEMENT_ICONS.clock.icon,
  gate: ELEMENT_ICONS.gate.icon,
  vault: ELEMENT_ICONS.vault.icon,
  channel: ELEMENT_ICONS.channel.icon,
  ai: ELEMENT_ICONS.ai.icon,
};

const KIND_SHAPE: Record<FlowGraphAccentKind, string> = {
  flow: "rounded-xl",
  store: "rounded-md",
  signal: "rounded-full",
  clock: "rounded-lg",
  gate: "rounded-md",
  vault: "rounded-md",
  channel: "rounded-xl",
  ai: "rounded-2xl",
};

function shellClass(data: FlowGraphNodeData, kind: FlowGraphAccentKind): string {
  return cn(
    "group relative flex h-full w-full items-center gap-2.5 border-2 px-2.5 text-xs transition-[opacity,filter,box-shadow,border-color] duration-200",
    KIND_SHAPE[kind],
    data.dimmed && "opacity-30 saturate-[0.35]",
    data.highlighted && "z-10",
    data.focused && "z-10",
  );
}

function shellStyle(kind: FlowGraphAccentKind, data: FlowGraphNodeData): CSSProperties {
  const accent = NODE_ACCENT[kind];
  const tint = `color-mix(in oklab, ${accent.accent} 20%, var(--card))`;
  if (data.highlighted || data.focused) {
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

/**
 * Motion wrapper for graph node shells — hover/tap affordance, highlight
 * scale, and a Replay playback pulse. Reduced-motion collapses to static.
 */
function NodeShell({
  data,
  kind,
  className,
  style,
  children,
  ...rest
}: {
  readonly data: FlowGraphNodeData;
  readonly kind: FlowGraphAccentKind;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children: React.ReactNode;
} & Record<string, unknown>) {
  const reduceMotion = useReducedMotion();
  const accent = NODE_ACCENT[kind];
  return (
    <motion.div
      className={className}
      style={style}
      initial={false}
      whileHover={reduceMotion ? undefined : { scale: 1.04 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      animate={{
        scale: reduceMotion ? 1 : data.active ? [1, 1.08, 1] : data.highlighted ? 1.02 : 1,
        boxShadow: data.active ? `0 0 0 2px ${accent.accent}, 0 0 30px ${accent.glow}` : undefined,
      }}
      transition={
        data.active
          ? { duration: 0.5, ease: "easeInOut" }
          : { type: "spring", stiffness: 400, damping: 28 }
      }
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function IconWell({
  kind,
  size = "sm",
}: {
  readonly kind: FlowGraphAccentKind;
  readonly size?: "sm" | "md";
}) {
  const accent = NODE_ACCENT[kind];
  const rounded =
    kind === "signal"
      ? "rounded-full"
      : kind === "store" || kind === "gate" || kind === "vault"
        ? "rounded-md"
        : "rounded-full";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border",
        size === "md" ? "size-9" : "size-7",
        rounded,
      )}
      style={{
        color: accent.accent,
        background: accent.well,
        borderColor: `color-mix(in oklab, ${accent.accent} 55%, transparent)`,
      }}
      aria-hidden
    >
      <HugeiconsIcon icon={KIND_ICON[kind]} size={size === "md" ? 17 : 15} strokeWidth={1.9} />
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

function CenterHandle({ type }: { readonly type: "source" | "target" }) {
  return (
    <Handle
      id="center"
      type={type}
      position={type === "source" ? Position.Right : Position.Left}
      isConnectable={false}
      className="oke-center-handle !top-1/2 !left-1/2 !size-px !-translate-x-1/2 !-translate-y-1/2 !border-0 !bg-transparent !opacity-0"
    />
  );
}

function LiveDot({ live, errors }: { readonly live: number; readonly errors: number }) {
  if (live <= 0) return null;
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        errors > 0 ? "bg-rose-400" : "bg-emerald-400",
        live > 0 && "animate-pulse",
      )}
      title={errors > 0 ? `${live} live · ${errors} failed` : `${live} live`}
    />
  );
}

function ElementDots({ elements }: { readonly elements: readonly OkeElement[] }) {
  if (elements.length === 0) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1" aria-hidden>
      {elements.map((element) => (
        <span
          key={element}
          className="size-1.5 rounded-full"
          style={{ background: NODE_ACCENT[element].accent }}
          title={ELEMENT_ICONS[element].label}
        />
      ))}
    </span>
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

/** Type pill on the middle orbit — one kind per element sector. */
export function TypeChipNode({ data }: NodeProps<GraphNode>) {
  const element = (data.kind in NODE_ACCENT ? data.kind : "flow") as FlowGraphAccentKind;
  return (
    <NodeShell
      data={data}
      kind={element}
      className={cn(shellClass(data, element), "justify-center gap-0 rounded-full px-2")}
      style={shellStyle(element, data)}
      data-slot="type-chip"
      data-type={data.refId}
    >
      <CenterHandle type="source" />
      <CenterHandle type="target" />
      <div className="min-w-0 truncate text-center text-[10px] leading-none font-medium tracking-wide text-foreground">
        {data.label}
      </div>
    </NodeShell>
  );
}

/** Compact unit chip on the outer ring. */
export function UnitChipNode({ data }: NodeProps<GraphNode>) {
  return (
    <NodeShell
      data={data}
      kind="flow"
      className={cn(shellClass(data, "flow"), "rounded-full px-2.5")}
      style={shellStyle("flow", data)}
      data-slot="unit-chip"
      data-unit={data.refId}
    >
      <CenterHandle type="source" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate font-medium tracking-wide text-foreground uppercase">
            {data.label}
          </div>
          <LiveDot live={data.live ?? 0} errors={data.errors ?? 0} />
        </div>
        <ElementDots elements={data.elements ?? []} />
      </div>
      {data.badge ? <MetaBadge text={data.badge} /> : null}
    </NodeShell>
  );
}

/** Eight-element disc on the inner orbit. */
export function ElementHubNode({ data }: NodeProps<GraphNode>) {
  const element = accentKindOf(data.refId) ?? "flow";
  const accent = NODE_ACCENT[element];
  return (
    <NodeShell
      data={data}
      kind={element}
      className={cn(
        shellClass(data, element),
        "flex-col justify-center gap-0.5 rounded-full px-1.5 text-center",
      )}
      style={{
        ...shellStyle(element, data),
        boxShadow: data.highlighted
          ? `0 0 0 1px ${accent.accent}, 0 0 22px ${accent.glow}`
          : `0 0 0 1px color-mix(in oklab, ${accent.accent} 55%, transparent)`,
      }}
      data-slot="element-hub"
      data-element={element}
    >
      <CenterHandle type="target" />
      <CenterHandle type="source" />
      <span
        className="text-[18px] font-semibold tracking-tight text-foreground"
        title={ELEMENT_ICONS[element].label}
      >
        {data.label}
      </span>
    </NodeShell>
  );
}

/** Seconds per hub beat — faster as more runs sit in the live window. */
function lawBeatPeriod(live: number): number {
  if (live >= 40) return 1.05;
  if (live >= 12) return 1.55;
  return 2.2;
}

/** Law disc at the hub center — larger, beats with live operations. */
export function LawNode({ data }: NodeProps<GraphNode>) {
  const reduceMotion = useReducedMotion();
  const live = data.live ?? 0;
  const errors = data.errors ?? 0;
  const [hits, setHits] = useState(0);
  const prevLive = useRef(live);

  useEffect(() => {
    if (live > prevLive.current) setHits((n) => n + 1);
    prevLive.current = live;
  }, [live]);

  const busy = live > 0;
  const period = lawBeatPeriod(live);
  const ink = errors > 0 ? "var(--color-rose-400)" : "var(--foreground)";

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-visible",
        data.highlighted && "z-10",
      )}
      data-slot="law-hub"
      data-live={live}
    >
      <CenterHandle type="target" />
      {!reduceMotion && busy ? (
        <>
          <span
            aria-hidden
            className="oke-law-ripple"
            style={{ animationDuration: `${period}s`, color: ink }}
          />
          <span
            aria-hidden
            className="oke-law-ripple"
            style={{
              animationDuration: `${period}s`,
              animationDelay: `${period / 2}s`,
              color: ink,
            }}
          />
        </>
      ) : null}
      {hits > 0 && !reduceMotion ? (
        <span key={hits} aria-hidden className="oke-law-hit" style={{ color: ink }} />
      ) : null}
      <motion.div
        className="flex h-full w-full items-center justify-center rounded-full border-4 bg-card px-4 text-center"
        style={{
          borderColor: "color-mix(in oklab, var(--foreground) 82%, var(--border))",
          boxShadow: data.highlighted
            ? `0 0 0 1px ${ink}, 0 0 36px color-mix(in oklab, ${ink} 28%, transparent)`
            : `inset 0 0 28px color-mix(in oklab, var(--foreground) 7%, transparent), 0 0 22px color-mix(in oklab, ${ink} ${busy ? 16 : 6}%, transparent)`,
        }}
        animate={reduceMotion || !busy ? { scale: 1 } : { scale: [1, 1.045, 1] }}
        transition={
          reduceMotion || !busy
            ? { duration: 0 }
            : { duration: period, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <OkeLogo className="h-7 w-auto text-foreground" />
      </motion.div>
    </div>
  );
}

/** Dashed orbit ring (non-interactive). */
export function OrbitNode() {
  return (
    <div
      className="pointer-events-none h-full w-full rounded-full border border-dashed border-foreground/15"
      data-slot="orbit"
    />
  );
}

function accentKindOf(refId: string): FlowGraphAccentKind | null {
  if (refId in NODE_ACCENT) return refId as FlowGraphAccentKind;
  return null;
}

function LeafNode({
  data,
  kind,
  slot,
}: {
  readonly data: FlowGraphNodeData;
  readonly kind: FlowGraphAccentKind;
  readonly slot: string;
}) {
  return (
    <NodeShell
      data={data}
      kind={kind}
      className={shellClass(data, kind)}
      style={shellStyle(kind, data)}
      data-slot={slot}
      data-flow-id={kind === "flow" ? data.refId : undefined}
      data-highlighted={data.highlighted ? "true" : "false"}
    >
      <HandleDot type="target" kind={kind} />
      <CenterHandle type="source" />
      <IconWell kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <MetaBadge text={data.badge ?? data.plane ?? data.facet ?? kind} />
        </div>
      </div>
      {kind === "flow" || kind === "signal" ? <HandleDot type="source" kind={kind} /> : null}
    </NodeShell>
  );
}

/** Flow node — circular icon well + sky accent bar. */
export function FlowNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="flow" slot="flow-node" />;
}

/** Store resource node — square icon well + emerald accent. */
export function StoreNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="store" slot="store-node" />;
}

/** Signal node — pill shell + amber accent. */
export function SignalNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="signal" slot="signal-node" />;
}

/** AI prompt node — soft rounded shell + rose accent. */
export function AiNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="ai" slot="ai-node" />;
}

/** Clock schedule node — indigo accent. */
export function ClockNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="clock" slot="clock-node" />;
}

/** Gate node — violet accent. */
export function GateNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="gate" slot="gate-node" />;
}

/** Vault secret node — slate accent. */
export function VaultNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="vault" slot="vault-node" />;
}

/** Channel template node — fuchsia accent. */
export function ChannelNode({ data }: NodeProps<GraphNode>) {
  return <LeafNode data={data} kind="channel" slot="channel-node" />;
}

/** nodeTypes registry for `<ReactFlow>`. */
export const flowGraphNodeTypes = {
  unit: UnitNode,
  unitChip: UnitChipNode,
  typeChip: TypeChipNode,
  element: ElementHubNode,
  law: LawNode,
  orbit: OrbitNode,
  flow: FlowNode,
  store: StoreNode,
  signal: SignalNode,
  ai: AiNode,
  clock: ClockNode,
  gate: GateNode,
  vault: VaultNode,
  channel: ChannelNode,
};
