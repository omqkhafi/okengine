/**
 * Two kinds of schedules for Clock — anonymous every() vs named clock().
 *
 * Each card ticks the way its schedule does: `every` beats a metronome dot on
 * a fixed interval, `clock` sweeps an analog hand like a cron dial. Reduced
 * motion holds both still.
 */

"use client";

import { motion } from "framer-motion";
import { CalendarClock, Timer, type LucideIcon } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const tone = CHIP_TONE.orange;

const KINDS: ReadonlyArray<{
  readonly id: "every" | "clock";
  readonly icon: LucideIcon;
  readonly declare: string;
  readonly console: string;
  readonly cronTz: string;
  readonly runtimeEdit: string;
  readonly useFor: string;
}> = [
  {
    id: "every",
    icon: Timer,
    declare: 'every("1h")',
    console: "Not listed",
    cronTz: "Interval only",
    runtimeEdit: "No",
    useFor: "Simple fixed intervals — purge, sweep",
  },
  {
    id: "clock",
    icon: CalendarClock,
    declare: "clock(name, opts)",
    console: "Listed, with health",
    cronTz: "Cron + timezone",
    runtimeEdit: "When overridable",
    useFor: "Business schedules operators tune — reports, rollups",
  },
];

/**
 * Anonymous interval vs named schedule — same on(trigger, flow) underneath.
 */
export function ClockSchedules() {
  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Two schedule kinds: every is a fixed interval that never appears in the Console; clock is a named cron or interval schedule operators can inspect and edit when overridable."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Two kinds of schedules</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.clock.now() · never Date.now()
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        {KINDS.map((k) => {
          const Icon = k.icon;
          return (
            <RevealItem
              as="li"
              lift
              key={k.id}
              className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-5"
            >
              <div className="flex items-center gap-2">
                <code className="inline-flex w-fit max-w-full items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-[11px] break-all text-fd-foreground">
                  <Icon
                    className="size-3 shrink-0 text-fd-muted-foreground"
                    aria-hidden
                    strokeWidth={1.75}
                  />
                  {k.declare}
                </code>
                {k.id === "every" ? <Metronome /> : <CronDial />}
              </div>
              <dl className="flex flex-col gap-1 text-[11px]">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fd-muted-foreground/70">Console</dt>
                  <dd className="min-w-0 text-fd-muted-foreground">{k.console}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fd-muted-foreground/70">Cron / tz</dt>
                  <dd className="min-w-0 text-fd-muted-foreground">{k.cronTz}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fd-muted-foreground/70">Runtime edit</dt>
                  <dd className="min-w-0 text-fd-muted-foreground">{k.runtimeEdit}</dd>
                </div>
              </dl>
              <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {k.useFor}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

/** Fixed-interval beat — the way `every("1h")` fires. */
function Metronome() {
  const reduced = useClientReducedMotion();
  return (
    <motion.span
      aria-hidden
      className={cn("size-2 rounded-full", tone.wash)}
      initial={false}
      animate={
        reduced ? { scale: 1, opacity: 0.7 } : { scale: [1, 1.7, 1], opacity: [0.9, 0.35, 0.9] }
      }
      transition={
        reduced ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
      }
    />
  );
}

/** Cron dial — a named schedule with timezone and a Console face. */
function CronDial() {
  const reduced = useClientReducedMotion();
  return (
    <svg viewBox="0 0 16 16" className="size-4" role="img" aria-label="cron dial">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--color-fd-border)" strokeWidth="1" />
      <circle cx="8" cy="8" r="1" fill="var(--color-fd-muted-foreground)" />
      <motion.g
        initial={false}
        animate={reduced ? { rotate: 300 } : { rotate: 360 }}
        transition={reduced ? { duration: 0 } : { duration: 12, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "8px 8px" }}
      >
        <line
          x1="8"
          y1="8"
          x2="8"
          y2="3.5"
          stroke="var(--oke-el-clock)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </motion.g>
    </svg>
  );
}
