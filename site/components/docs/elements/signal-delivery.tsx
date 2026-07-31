/**
 * Three delivery physics for Signal — once / broadcast / live.
 *
 * Each card runs its own delivery demo: one packet to one consumer (once),
 * one packet fanning out to three (broadcast), a continuous train (live).
 * Icons match the Signal preview chips in the Features grid. Ambient loops
 * like the Features drift — reduced motion holds the delivered end state.
 */

"use client";

import { motion } from "framer-motion";
import { Activity, CircleDot, Share2, type LucideIcon } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/docs/reveal";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const PHYSICS: ReadonlyArray<{
  readonly id: "once" | "broadcast" | "live";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly semantic: string;
  readonly guarantee: string;
  readonly useFor: string;
}> = [
  {
    id: "once",
    label: "once",
    icon: CircleDot,
    semantic: "Queue — competing consumers",
    guarantee: "Retries + dead-letter queue",
    useFor: "Exactly-once jobs: emails, payment sync",
  },
  {
    id: "broadcast",
    label: "broadcast",
    icon: Share2,
    semantic: "Pub/sub — every subscriber",
    guarantee: "Each consumer receives a copy",
    useFor: "Cache invalidation, cross-service events",
  },
  {
    id: "live",
    label: "live",
    icon: Activity,
    semantic: "Stream — client-subscribable",
    guarantee: "Replayable feed",
    useFor: "Dashboards, progress updates",
  },
];

const EMIT_X = 6;
const MID_X = 40;
const SINK_X = 78;
const ROW_Y = 13;
const FAN_Y = [4, 13, 21] as const;

/** Packet ink — the element's soft ink var, as SVG presentation attributes. */
const PACKET = "var(--oke-el-signal)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

/**
 * One declaration shape, three delivery physics — no library swap.
 */
export function SignalDelivery() {
  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Signal delivery physics: once is a queue with retries and dead-letter; broadcast reaches every subscriber; live is a replayable stream clients subscribe to."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">delivery — pick the physics</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          required · no default
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-3"
      >
        {PHYSICS.map((p) => {
          const Icon = p.icon;
          return (
            <RevealItem
              as="li"
              lift
              key={p.id}
              className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-5"
            >
              <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                <Icon className="size-3 text-fd-muted-foreground" aria-hidden strokeWidth={1.75} />
                {p.label}
              </code>
              <DeliveryDemo kind={p.id} />
              <p className="text-xs font-medium text-fd-foreground">{p.semantic}</p>
              <p className="text-xs text-pretty text-fd-muted-foreground">{p.guarantee}</p>
              <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {p.useFor}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

/**
 * The live delivery strip — one emit lane and the packet behaviour that
 * makes each physics distinct.
 *
 * @param kind - Which physics to demo
 */
function DeliveryDemo({ kind }: { readonly kind: "once" | "broadcast" | "live" }) {
  const reduced = useClientReducedMotion();

  return (
    <svg viewBox="0 0 84 25" className="h-6 w-21" role="img" aria-label={`${kind} delivery demo`}>
      <line
        x1={EMIT_X}
        y1={ROW_Y}
        x2={SINK_X}
        y2={ROW_Y}
        stroke={BOX_LINE}
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <circle cx={EMIT_X} cy={ROW_Y} r="2.5" fill={IDLE} />

      {kind === "once" ? (
        <>
          <rect
            x={SINK_X - 1}
            y={ROW_Y - 5}
            width="10"
            height="10"
            rx="2"
            fill={BOX}
            stroke={BOX_LINE}
          />
          <motion.circle
            cy={ROW_Y}
            r="2.5"
            fill={PACKET}
            initial={false}
            animate={
              reduced
                ? { cx: SINK_X - 4, opacity: 1 }
                : { cx: [EMIT_X, SINK_X - 4], opacity: [1, 1] }
            }
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 1.4, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut" }
            }
          />
        </>
      ) : null}

      {kind === "broadcast" ? (
        <>
          {FAN_Y.map((y) => (
            <rect
              key={y}
              x={SINK_X - 1}
              y={y - 4}
              width="9"
              height="9"
              rx="2"
              fill={BOX}
              stroke={BOX_LINE}
            />
          ))}
          {FAN_Y.map((y, i) => (
            <motion.circle
              key={y}
              r="2"
              fill={PACKET}
              initial={false}
              animate={
                reduced
                  ? { cx: SINK_X - 4, cy: y, opacity: 1 }
                  : {
                      cx: [EMIT_X, MID_X, SINK_X - 4],
                      cy: [ROW_Y, ROW_Y, y],
                      opacity: [0, 1, 1, 0],
                    }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      duration: 1.5,
                      delay: i * 0.08,
                      repeat: Infinity,
                      repeatDelay: 1,
                      ease: "easeInOut",
                    }
              }
            />
          ))}
        </>
      ) : null}

      {kind === "live" ? (
        <>
          {[0, 1, 2].map((i) => (
            <motion.circle
              key={i}
              cy={ROW_Y}
              r="2"
              fill={PACKET}
              initial={false}
              animate={
                reduced
                  ? { cx: SINK_X - 6 - i * 9, opacity: 0.9 - i * 0.25 }
                  : { cx: [EMIT_X, SINK_X + 4], opacity: [0, 1, 1, 0] }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 1.6, delay: i * 0.45, repeat: Infinity, ease: "linear" }
              }
            />
          ))}
        </>
      ) : null}
    </svg>
  );
}
