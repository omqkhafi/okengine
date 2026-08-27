/**
 * Six triggers, one Flow species — fan-in diagram for the Flow element page.
 *
 * The beat fires each trigger in turn: the row lights and a packet springs
 * across the lane into the Flow panel (contracts stay lit). Any trigger, same
 * flow — that is the whole diagram. Deterministic from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const TRIGGERS: ReadonlyArray<{
  readonly syntax: string;
  readonly starts: string;
  readonly replaces: string;
}> = [
  { syntax: 'http.post("/orders")', starts: "a request arrives", replaces: "endpoint · handler" },
  { syntax: "orderPlaced", starts: "another flow emits", replaces: "queue consumer" },
  { syntax: 'every("1h")', starts: "time passes", replaces: "cron job" },
  {
    syntax: 'db.table(orders).changed("status")',
    starts: "a row changes",
    replaces: "CDC pipeline",
  },
  { syntax: "fx.call", starts: "another flow calls in", replaces: '"private" helper' },
  {
    syntax: 'mcp.tool("bookings.create")',
    starts: "an agent calls a tool",
    replaces: "OAuth tool route",
  },
];

const CONTRACTS = ["in", "out", "errors", "do"] as const;

const TICK_MS = 1400;
const tone = CHIP_TONE.sky;
const PACKET = "var(--oke-el-flow)";
const BOX_LINE = "var(--color-fd-border)";

const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

/**
 * One species, many triggers — visually the same `on(trigger, flow)` spine.
 */
export function FlowTriggers() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes on http → Flow (first trigger settled). */
  const active = tick === null ? 0 : tick % TRIGGERS.length;
  const live = tick !== null;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Six triggers — HTTP, signal, interval, row change, fx.call, and an MCP tool — all binding to the same Flow species."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Six triggers, one species</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          on(trigger, flow)
        </code>
      </div>

      <div className="grid gap-px bg-fd-border @min-[40rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RevealGroup as="ul" className="flex min-w-0 flex-col gap-1.5 bg-fd-card px-4 py-4 sm:px-5">
          {TRIGGERS.map((trigger, i) => {
            const firing = i === active;
            return (
              <RevealItem
                as="li"
                key={trigger.syntax}
                className={cn(
                  "flex min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2 transition-colors duration-300",
                  firing ? tone.active : "border-fd-border bg-fd-secondary/30",
                )}
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <code className="min-w-0 font-mono text-[11px] break-all text-fd-foreground">
                    {trigger.syntax}
                  </code>
                  <span className="flex items-center gap-2 text-[11px] text-fd-muted-foreground">
                    {trigger.starts}
                    <span className="relative flex size-1.5 shrink-0" aria-hidden>
                      {firing && live ? <BeatPing key={tick} className={tone.wash} /> : null}
                      <span
                        className={cn(
                          "size-1.5 rounded-full transition-colors duration-300",
                          firing ? tone.hairline : "bg-fd-border",
                        )}
                      />
                    </span>
                  </span>
                </div>
                <span className="text-[10px] text-fd-muted-foreground/70">
                  replaces {trigger.replaces}
                </span>
              </RevealItem>
            );
          })}
        </RevealGroup>

        <RevealGroup
          as="div"
          className={cn(
            "flex min-w-0 flex-col justify-center gap-2.5 px-4 py-4 transition-colors duration-300 sm:px-5",
            tone.lit,
          )}
        >
          <RevealItem as="div" className="flex flex-col gap-1.5">
            <FanInPacket firing={live} beat={tick ?? 0} />
            <p className="text-sm font-medium text-fd-foreground">one Flow</p>
          </RevealItem>
          <RevealItem as="div" className="flex flex-wrap gap-1">
            {CONTRACTS.map((c) => (
              <code
                key={c}
                className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", tone.active)}
              >
                {c}
              </code>
            ))}
          </RevealItem>
          <RevealItem as="div">
            <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
              Contracts, do, effects — identical shape. Only the trigger changed. No controller, no
              consumer class, no cron runner to wire.
            </p>
          </RevealItem>
        </RevealGroup>
      </div>
    </figure>
  );
}

/** Packet crosses the “all become” lane into the Flow panel on each beat. */
function FanInPacket({ firing, beat }: { readonly firing: boolean; readonly beat: number }) {
  return (
    <svg viewBox="0 0 120 16" className="h-4 w-28" role="presentation" aria-hidden>
      <line x1="4" y1="8" x2="116" y2="8" stroke={BOX_LINE} strokeWidth="1" strokeDasharray="2 3" />
      <text
        x="60"
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
        fill={PACKET}
        initial={false}
        animate={firing ? { cx: [8, 112], opacity: [0, 1, 1, 0] } : { cx: 112, opacity: 0.9 }}
        transition={firing ? { duration: 0.9, ease: "easeInOut" } : { ...SPRING, duration: 0 }}
      />
    </svg>
  );
}
