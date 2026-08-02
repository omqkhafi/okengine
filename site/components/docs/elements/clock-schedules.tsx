/**
 * Two schedule kinds, one Flow species — Clock overview figure.
 *
 * `every("1h")` and `clock(name, opts)` take turns firing; a packet crosses
 * into the same Flow panel. The flow never sees which kind woke it.
 * Deterministic from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, Timer, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.orange;
const TICK_MS = 1300;

const KINDS: ReadonlyArray<{
  readonly id: "every" | "clock";
  readonly icon: LucideIcon;
  readonly syntax: string;
  readonly starts: string;
  readonly console: string;
  readonly shape: string;
}> = [
  {
    id: "every",
    icon: Timer,
    syntax: 'every("1h")',
    starts: "fixed interval",
    console: "Not listed",
    shape: "Interval only — purge, sweep",
  },
  {
    id: "clock",
    icon: CalendarClock,
    syntax: 'clock("daily-report", { cron, timezone })',
    starts: "cron + timezone",
    console: "Listed, with health",
    shape: "Named — operators pause / edit when overridable",
  },
];

/**
 * Anonymous interval vs named schedule — same `on(trigger, flow)` underneath.
 */
export function ClockSchedules() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % KINDS.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Two schedule kinds — every is a fixed interval, clock is a named cron or interval — both bind with on(trigger, flow) to the same Flow species."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Two kinds, one species</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          on(trigger, flow)
        </code>
      </div>

      <div className="grid gap-px bg-fd-border @min-[40rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <RevealGroup as="ul" className="flex min-w-0 flex-col gap-1.5 bg-fd-card px-4 py-4 sm:px-5">
          {KINDS.map((k, i) => {
            const Icon = k.icon;
            const firing = i === active;
            return (
              <RevealItem
                as="li"
                key={k.id}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors duration-300",
                  firing ? tone.active : "border-fd-border bg-fd-secondary/30",
                )}
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <code className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] break-all text-fd-foreground">
                    <Icon
                      className={cn(
                        "size-3 shrink-0 transition-colors duration-300",
                        firing ? tone.icon : "text-fd-muted-foreground",
                      )}
                      aria-hidden
                      strokeWidth={1.75}
                    />
                    {k.syntax}
                  </code>
                  <span className="flex items-center gap-2 text-[11px] text-fd-muted-foreground">
                    {k.starts}
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
                <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-fd-muted-foreground/80">
                  <div className="flex gap-1.5">
                    <dt className="text-fd-muted-foreground/60">Console</dt>
                    <dd>{k.console}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-fd-muted-foreground/60">Use</dt>
                    <dd>{k.shape}</dd>
                  </div>
                </dl>
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
              Same <code className="font-mono text-[10px]">on(trigger, flow)</code>. The{" "}
              <code className="font-mono text-[10px]">do</code> never knows whether an interval or a
              named cron woke it.
            </p>
          </RevealItem>
        </RevealGroup>
      </div>
    </figure>
  );
}
