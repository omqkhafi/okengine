/**
 * Six triggers, one Flow species — fan-in diagram for the Flow element page.
 *
 * The ambient beat cycles through each trigger in turn, or the reader can click
 * and hover any trigger to inspect its binding and payload contract. A packet
 * springs across the lane into the Flow panel with matching element ink.
 * Any trigger, same flow — that is the whole diagram. Deterministic from one tick.
 */

"use client";

import { motion } from "framer-motion";
import {
  Bot,
  Database,
  Globe,
  Radio,
  Timer,
  Workflow,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE, type ElementChipTone } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

interface TriggerSpec {
  readonly id: string;
  readonly element: string;
  readonly toneKey: ElementChipTone;
  readonly icon: LucideIcon;
  readonly syntax: string;
  readonly starts: string;
  readonly replaces: string;
  readonly binding: string;
  readonly flowName: string;
  readonly inPayload: string;
  readonly description: string;
}

const TRIGGERS: ReadonlyArray<TriggerSpec> = [
  {
    id: "http",
    element: "Flow",
    toneKey: "sky",
    icon: Globe,
    syntax: 'http.post("/orders")',
    starts: "a request arrives",
    replaces: "endpoint · handler",
    binding: 'on(http.post("/orders"), createOrder)',
    flowName: "orders.create",
    inPayload: '{ sku: "desk-mat", qty: 2 }',
    description: "HTTP requests validate JSON body, query params, and headers directly into in.",
  },
  {
    id: "signal",
    element: "Signal",
    toneKey: "amber",
    icon: Radio,
    syntax: "orderPlaced",
    starts: "another flow emits",
    replaces: "queue consumer",
    binding: "on(orderPlaced, fulfillOrder)",
    flowName: "orders.fulfill",
    inPayload: '{ orderId: "ord_01jq7z", count: 2 }',
    description: "Queue messages or pub/sub broadcasts deliver the event payload straight to in.",
  },
  {
    id: "clock",
    element: "Clock",
    toneKey: "orange",
    icon: Timer,
    syntax: 'clock("hourly", { every: "1h" })',
    starts: "time passes",
    replaces: "cron job",
    binding: "on(hourlyClock, syncInventory)",
    flowName: "inventory.sync",
    inPayload: "{ scheduledAt: 1740844800000 }",
    description: "Intervals or cron schedules wake the flow with the execution timestamp in in.",
  },
  {
    id: "cdc",
    element: "Store",
    toneKey: "teal",
    icon: Database,
    syntax: 'db.table(orders).changed("status")',
    starts: "a row changes",
    replaces: "CDC pipeline",
    binding: 'on(db.table(orders).changed("status"), onStatusChange)',
    flowName: "orders.onStatusChange",
    inPayload: '{ before: { ... }, after: { status: "paid" } }',
    description: "Database change-data-capture triggers pass row mutations directly to in.",
  },
  {
    id: "call",
    element: "Flow",
    toneKey: "sky",
    icon: Workflow,
    syntax: "fx.call",
    starts: "another flow calls in",
    replaces: '"private" helper',
    binding: "fx.call(calculateTax, { amount: 120 })",
    flowName: "orders.calculateTax",
    inPayload: "{ amount: 120, rate: 0.08 }",
    description: "Private internal flows execute via fx.call with typed input validation.",
  },
  {
    id: "mcp",
    element: "AI",
    toneKey: "rose",
    icon: Bot,
    syntax: 'mcp.tool("bookings.create")',
    starts: "an agent calls a tool",
    replaces: "OAuth tool route",
    binding: 'on(mcp.tool("bookings.create").gate(member), createBooking)',
    flowName: "bookings.create",
    inPayload: '{ date: "2026-09-01", guests: 4 }',
    description: "Model Context Protocol exposes flow contracts as typed tools for AI agents.",
  },
];

const CONTRACTS = ["in", "out", "errors", "do"] as const;

const TICK_MS = 2000;
const BOX_LINE = "var(--color-fd-border)";

const ELEMENT_VAR_MAP: Record<ElementChipTone, string> = {
  sky: "var(--oke-el-flow)",
  amber: "var(--oke-el-signal)",
  orange: "var(--oke-el-clock)",
  teal: "var(--oke-el-store)",
  rose: "var(--oke-el-ai)",
  emerald: "var(--oke-el-gate)",
  yellow: "var(--oke-el-vault)",
  cyan: "var(--oke-el-channel)",
};

/**
 * One species, many triggers — visually the same `on(trigger, flow)` spine.
 */
export function FlowTriggers() {
  const reduced = useClientReducedMotion();
  const tick = useTick(TICK_MS);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Active trigger precedence: hovered > selected > ambient tick
  const activeIndex = (() => {
    if (hoveredId !== null) {
      const idx = TRIGGERS.findIndex((t) => t.id === hoveredId);
      if (idx !== -1) return idx;
    }
    if (selectedId !== null) {
      const idx = TRIGGERS.findIndex((t) => t.id === selectedId);
      if (idx !== -1) return idx;
    }
    if (reduced || tick === null) return 0;
    return tick % TRIGGERS.length;
  })();

  const activeTrigger = TRIGGERS[activeIndex] ?? TRIGGERS[0]!;
  const activeTone = CHIP_TONE[activeTrigger.toneKey];
  const activePacket = ELEMENT_VAR_MAP[activeTrigger.toneKey];
  const isManuallyControlled = selectedId !== null || hoveredId !== null;
  const isLive = !reduced && (!isManuallyControlled || hoveredId !== null || selectedId !== null);

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Six triggers — HTTP, signal, interval, row change, fx.call, and an MCP tool — all binding to the same Flow species."
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-fd-foreground">Six triggers, one species</p>
          {selectedId !== null && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1 rounded border border-fd-border bg-fd-secondary/60 px-1.5 py-0.5 text-[10px] text-fd-muted-foreground hover:bg-fd-secondary hover:text-fd-foreground transition-colors cursor-pointer"
              title="Resume automatic cycle"
            >
              <RotateCcw className="size-2.5" />
              <span>Resume cycle</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
            on(trigger, flow)
          </code>
        </div>
      </div>

      <div className="grid gap-px bg-fd-border @min-[40rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <RevealGroup
          as="ul"
          className="flex min-w-0 flex-col gap-1.5 bg-fd-card p-3 sm:p-4"
        >
          {TRIGGERS.map((trigger, i) => {
            const Icon = trigger.icon;
            const firing = i === activeIndex;
            const itemTone = CHIP_TONE[trigger.toneKey];
            const isSelected = selectedId === trigger.id;

            return (
              <RevealItem as="li" key={trigger.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => handleSelect(trigger.id)}
                  onMouseEnter={() => setHoveredId(trigger.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    "group w-full text-left flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50",
                    firing
                      ? cn(itemTone.active, isSelected && "ring-1 ring-fd-border")
                      : "border-fd-border bg-fd-secondary/30 hover:bg-fd-secondary/60 hover:border-fd-border/80",
                  )}
                  aria-pressed={firing}
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0 transition-colors duration-200",
                          firing ? itemTone.icon : "text-fd-muted-foreground group-hover:text-fd-foreground",
                        )}
                        aria-hidden
                        strokeWidth={1.75}
                      />
                      <code className="min-w-0 font-mono text-[11px] font-medium break-all text-fd-foreground">
                        {trigger.syntax}
                      </code>
                    </div>
                    <span className="flex items-center gap-1.5 text-[11px] text-fd-muted-foreground shrink-0">
                      <span>{trigger.starts}</span>
                      <span className="relative flex size-1.5 shrink-0" aria-hidden>
                        {firing && isLive ? (
                          <BeatPing key={`${trigger.id}-${tick}`} className={itemTone.wash} />
                        ) : null}
                        <span
                          className={cn(
                            "size-1.5 rounded-full transition-colors duration-200",
                            firing ? itemTone.hairline : "bg-fd-border",
                          )}
                        />
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10px] text-fd-muted-foreground/75">
                    <span>replaces {trigger.replaces}</span>
                    <span
                      className={cn(
                        "rounded px-1 py-0.2 font-mono text-[9px] uppercase tracking-wider transition-opacity",
                        firing ? "opacity-100 font-semibold" : "opacity-0 group-hover:opacity-60",
                      )}
                    >
                      {trigger.element}
                    </span>
                  </div>
                </button>
              </RevealItem>
            );
          })}
        </RevealGroup>

        <RevealGroup
          as="div"
          className={cn(
            "flex min-w-0 flex-col justify-between gap-3 p-4 sm:p-5 transition-colors duration-300",
            activeTone.lit,
          )}
        >
          <div className="flex flex-col gap-3 min-w-0">
            <RevealItem as="div" className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-fd-foreground">one Flow</p>
                <code
                  className={cn(
                    "rounded border px-1.5 py-0.2 font-mono text-[10px] font-medium transition-colors duration-300",
                    activeTone.active,
                  )}
                >
                  {activeTrigger.flowName}
                </code>
              </div>
              <FanInPacket
                firing={isLive}
                beat={tick ?? 0}
                color={activePacket}
                key={activeTrigger.id}
              />
            </RevealItem>

            <RevealItem as="div" className="min-w-0">
              <div className="rounded-md border border-fd-border/70 bg-fd-card/80 p-2.5 shadow-xs">
                <p className="text-[10px] font-mono tracking-wider text-fd-muted-foreground uppercase mb-1">
                  Binding
                </p>
                <code className="block font-mono text-[11px] font-medium text-fd-foreground break-all">
                  {activeTrigger.binding}
                </code>
              </div>
            </RevealItem>

            <RevealItem as="div" className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap gap-1 items-center">
                {CONTRACTS.map((c) => {
                  const isInput = c === "in";
                  return (
                    <code
                      key={c}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
                        isInput ? activeTone.active : "border-fd-border bg-fd-card text-fd-muted-foreground",
                      )}
                    >
                      {c}
                    </code>
                  );
                })}
              </div>

              <div className="rounded border border-fd-border/60 bg-fd-card/60 px-2.5 py-1.5 text-[11px] font-mono text-fd-muted-foreground">
                <span className="text-fd-foreground/70 font-semibold">in: </span>
                <span className="break-all">{activeTrigger.inPayload}</span>
              </div>
            </RevealItem>
          </div>

          <RevealItem as="div" className="pt-2 border-t border-fd-border/50">
            <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
              {activeTrigger.description}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-pretty text-fd-muted-foreground/75">
              Contracts, do, effects — identical shape. Only the trigger changed.
            </p>
          </RevealItem>
        </RevealGroup>
      </div>
    </figure>
  );
}

/** Packet crosses the “all become” lane into the Flow panel on each beat. */
function FanInPacket({
  firing,
  beat,
  color,
}: {
  readonly firing: boolean;
  readonly beat: number;
  readonly color: string;
}) {
  return (
    <svg viewBox="0 0 100 16" className="h-4 w-24 shrink-0" role="presentation" aria-hidden>
      <line x1="4" y1="8" x2="96" y2="8" stroke={BOX_LINE} strokeWidth="1" strokeDasharray="2 3" />
      <text
        x="50"
        y="5"
        textAnchor="middle"
        className="fill-fd-muted-foreground/70"
        style={{ fontSize: 6, fontFamily: "ui-monospace, monospace", letterSpacing: "0.12em" }}
      >
        ALL BECOME
      </text>
      <motion.circle
        key={firing ? beat : "static"}
        cy="8"
        r="2.5"
        fill={color}
        initial={false}
        animate={firing ? { cx: [6, 94], opacity: [0, 1, 1, 0] } : { cx: 94, opacity: 0.9 }}
        transition={
          firing
            ? { duration: 0.85, ease: "easeInOut" }
            : { type: "spring", stiffness: 380, damping: 32, mass: 0.7, duration: 0 }
        }
      />
    </svg>
  );
}
