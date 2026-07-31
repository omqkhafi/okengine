/**
 * Five triggers, one Flow species — fan-in diagram for the Flow element page.
 *
 * The beat fires each trigger in turn: the row lights and a packet crosses the
 * "all become" lane into the Flow panel. Any trigger, same flow — that is the
 * whole diagram. Deterministic from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
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
  { syntax: "db.table(orders).changed()", starts: "a row changes", replaces: "CDC pipeline" },
  { syntax: "fx.call", starts: "another flow calls in", replaces: '"private" helper' },
];

const TICK_MS = 1400;
const tone = CHIP_TONE.sky;

/**
 * One species, many triggers — visually the same `on(trigger, flow)` spine.
 */
export function FlowTriggers() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % TRIGGERS.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Five triggers — HTTP, signal, interval, row change, and fx.call — all binding to the same Flow species."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Five triggers, one species</p>
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
                      {firing && tick !== null ? (
                        <BeatPing key={tick} className={tone.wash} />
                      ) : null}
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
          className="flex min-w-0 flex-col justify-center gap-2 bg-fd-card px-4 py-4 sm:px-5"
        >
          <RevealItem
            as="div"
            className="relative flex items-center gap-2 text-fd-muted-foreground/70"
          >
            <ArrowRight className="size-3.5 shrink-0 @max-[40rem]:rotate-90" aria-hidden />
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase">all become</span>
            {/* Packet crossing into the Flow panel on each fired trigger. */}
            {tick !== null ? (
              <motion.span
                key={tick}
                aria-hidden
                className={cn("absolute left-8 size-1.5 rounded-full", tone.wash)}
                initial={{ x: 0, opacity: 0 }}
                animate={{ x: 56, opacity: [0, 1, 1, 0] }}
                transition={{ duration: 0.9, ease: "easeInOut" }}
              />
            ) : null}
          </RevealItem>
          <RevealItem as="div">
            <p className="text-sm font-medium text-fd-foreground">one Flow</p>
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
