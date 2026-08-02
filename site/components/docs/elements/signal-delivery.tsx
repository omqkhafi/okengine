/**
 * Three delivery physics for Signal — once / broadcast / live.
 *
 * Mode spotlight: cards take turns lit. Each mini-demo proves the claim
 * tables under-teach — competing claim (once), every-subscriber copy
 * (broadcast), retained history to a late bus.live() (live). Deterministic
 * from one tick; reduced motion holds the delivered end state.
 */

"use client";

import { motion } from "framer-motion";
import { Activity, CircleDot, Share2, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.amber;
const PACKET = "var(--oke-el-signal)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };
const TICK_MS = 1400;

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
    guarantee: "Exactly one claims · retries + DLQ",
    useFor: "At-least-once jobs: emails, payment sync (idempotent consumers)",
  },
  {
    id: "broadcast",
    label: "broadcast",
    icon: Share2,
    semantic: "Pub/sub — every subscriber",
    guarantee: "Each subscriber id gets its own copy",
    useFor: "Cache invalidation, cross-service events",
  },
  {
    id: "live",
    label: "live",
    icon: Activity,
    semantic: "Stream — retained feed",
    guarantee: "Late bus.live() replays full history",
    useFor: "Status feeds, progress — server-side today",
  },
];

const EMIT_X = 6;
const SINK_X = 72;
const ROW_Y = 13;
const FAN_Y = [4, 13, 21] as const;
const SUBS = ["sub-a", "sub-b", "sub-c"] as const;

/**
 * One declaration shape, three delivery physics — no library swap.
 */
export function SignalDelivery() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % PHYSICS.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Signal delivery physics: once — two workers compete and exactly one claims; broadcast — every subscriber gets a copy; live — a late bus.live() subscriber replays the full retained history."
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
        {PHYSICS.map((p, i) => {
          const Icon = p.icon;
          const live = i === active;
          return (
            <RevealItem
              as="li"
              lift
              key={p.id}
              className={cn(
                "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
                live ? tone.lit : "bg-fd-card",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                  <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
                  {p.label}
                </code>
                <span className="relative flex size-1.5 shrink-0" aria-hidden>
                  {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-300",
                      live ? tone.hairline : "bg-fd-border",
                    )}
                  />
                </span>
              </div>
              <DeliveryDemo kind={p.id} live={live} />
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
 * Per-mode packet physics — springs settle to discrete positions (no SVG width anim).
 *
 * @param kind - Which physics to demo
 * @param live - Whether this card is the active spotlight
 */
function DeliveryDemo({
  kind,
  live,
}: {
  readonly kind: "once" | "broadcast" | "live";
  readonly live: boolean;
}) {
  if (kind === "once") return <OnceDemo live={live} />;
  if (kind === "broadcast") return <BroadcastDemo live={live} />;
  return <LiveDemo live={live} />;
}

/** Two workers compete; exactly one claims (worker-a wins deterministically). */
function OnceDemo({ live }: { readonly live: boolean }) {
  const workers = [
    { id: "worker-a", y: 7, wins: true },
    { id: "worker-b", y: 19, wins: false },
  ] as const;

  return (
    <svg viewBox="0 0 84 26" className="h-7 w-full max-w-28" role="presentation" aria-hidden>
      <circle cx={EMIT_X} cy={ROW_Y} r="2.5" fill={IDLE} />
      {workers.map((w) => (
        <g key={w.id}>
          <line
            x1={EMIT_X + 4}
            y1={ROW_Y}
            x2={SINK_X - 2}
            y2={w.y}
            stroke={BOX_LINE}
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <motion.rect
            x={SINK_X - 1}
            y={w.y - 4}
            width="11"
            height="8"
            rx="2"
            fill={BOX}
            strokeWidth="1"
            initial={false}
            animate={{
              stroke: live && w.wins ? PACKET : BOX_LINE,
              opacity: live ? (w.wins ? 1 : 0.45) : 0.7,
            }}
            transition={{ duration: 0.3 }}
          />
        </g>
      ))}
      <motion.circle
        r="2.5"
        fill={PACKET}
        initial={false}
        animate={
          live ? { cx: SINK_X + 4, cy: 7, opacity: 1 } : { cx: EMIT_X, cy: ROW_Y, opacity: 0.4 }
        }
        transition={SPRING}
      />
    </svg>
  );
}

/** One emit → every subscriber id receives its own copy. */
function BroadcastDemo({ live }: { readonly live: boolean }) {
  return (
    <svg viewBox="0 0 84 26" className="h-7 w-full max-w-28" role="presentation" aria-hidden>
      <circle cx={EMIT_X} cy={ROW_Y} r="2.5" fill={IDLE} />
      <line
        x1={EMIT_X + 4}
        y1={ROW_Y}
        x2={40}
        y2={ROW_Y}
        stroke={BOX_LINE}
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      {FAN_Y.map((y, i) => (
        <g key={SUBS[i]}>
          <line
            x1={40}
            y1={ROW_Y}
            x2={SINK_X - 2}
            y2={y}
            stroke={BOX_LINE}
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <rect
            x={SINK_X - 1}
            y={y - 4}
            width="11"
            height="8"
            rx="2"
            fill={BOX}
            stroke={BOX_LINE}
          />
          <motion.circle
            r="2"
            fill={PACKET}
            initial={false}
            animate={
              live
                ? { cx: SINK_X + 4, cy: y, opacity: 1 }
                : { cx: EMIT_X, cy: ROW_Y, opacity: 0.25 }
            }
            transition={{ ...SPRING, delay: live ? i * 0.05 : 0 }}
          />
        </g>
      ))}
    </svg>
  );
}

/** Retained frames + late bus.live() sink — history lights when the card is active. */
function LiveDemo({ live }: { readonly live: boolean }) {
  const frames = [
    { x: 18, label: "p" },
    { x: 34, label: "f" },
    { x: 50, label: "s" },
  ] as const;

  return (
    <svg viewBox="0 0 84 26" className="h-7 w-full max-w-28" role="presentation" aria-hidden>
      <circle cx={EMIT_X} cy={ROW_Y} r="2.5" fill={IDLE} />
      <line
        x1={EMIT_X + 4}
        y1={ROW_Y}
        x2={58}
        y2={ROW_Y}
        stroke={BOX_LINE}
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      {frames.map((f, i) => (
        <motion.circle
          key={f.label}
          cx={f.x}
          cy={ROW_Y}
          r="3"
          fill={PACKET}
          initial={false}
          animate={{ opacity: live ? 0.95 - i * 0.12 : 0.18 }}
          transition={{ duration: 0.3, delay: live ? i * 0.07 : 0 }}
        />
      ))}
      <motion.rect
        x={SINK_X - 1}
        y={ROW_Y - 5}
        width="12"
        height="10"
        rx="2"
        fill={BOX}
        initial={false}
        animate={{
          stroke: live ? PACKET : BOX_LINE,
          opacity: live ? 1 : 0.55,
        }}
        transition={{ duration: 0.3 }}
      />
      {/* Late-join packets settle onto the bus.live() sink. */}
      {frames.map((f, i) => (
        <motion.circle
          key={`late-${f.label}`}
          r="1.6"
          fill={PACKET}
          initial={false}
          animate={
            live
              ? { cx: SINK_X + 5, cy: ROW_Y - 2 + i * 2, opacity: 0.9 }
              : { cx: f.x, cy: ROW_Y, opacity: 0 }
          }
          transition={{ ...SPRING, delay: live ? 0.15 + i * 0.08 : 0 }}
        />
      ))}
    </svg>
  );
}
