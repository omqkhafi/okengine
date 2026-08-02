/**
 * Signal physics demos — claims that tables alone under-teach.
 *
 * - SignalOnceLease: claim sets lockedBy + leaseExpiresAt (30s); next consumer
 *   reclaims after expiry (at-least-once, no sweeper).
 * - SignalLiveReplay: live retains every payload; late bus.live() replays
 *   full history (placed → fulfilling → shipped).
 *
 * Same quality bar as SignalDelivery / StoreKvTtl: ambient tick phases,
 * BeatPing, reduced motion holds the end state. Deterministic — never Math.random().
 */

"use client";

import { motion } from "framer-motion";
import { Activity, Timer } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.amber;
const PACKET = "var(--oke-el-signal)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

function PhaseChip({
  label,
  live,
  tick,
}: {
  readonly label: string;
  readonly live: boolean;
  readonly tick: number | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <code
        className={cn(
          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
          live ? tone.active : "border-fd-border text-fd-muted-foreground",
        )}
      >
        {label}
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
  );
}

/* ─── once lease reclaim ──────────────────────────────────────────────── */

const LEASE_PHASES = ["pending", "claim", "lease", "reclaim"] as const;

/**
 * once claim sets lockedBy + leaseExpiresAt (default 30s); after expiry the
 * next consumer reclaims — at-least-once, no background sweeper.
 */
export function SignalOnceLease() {
  const tick = useTick(1100);
  const phase = tick === null ? 3 : tick % LEASE_PHASES.length;
  const label = LEASE_PHASES[phase];
  // Static end state under reduced motion: worker-b has reclaimed.
  const aHolds = phase === 1 || phase === 2;
  const bHolds = phase === 3;
  const pending = phase === 0;
  const leaseLit = phase === 2 ? 1 : phase === 1 ? 2 : phase === 0 ? 3 : 0;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="On once, a claim sets lockedBy and leaseExpiresAt (default 30s); after expiry the next consumer reclaims the same message (at-least-once). No background sweeper."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">once — claim, lease, reclaim</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          leaseMs · 30s default
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          no sweeper — next claim query reclaims
        </span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <RevealItem
          as="li"
          lift
          className={cn(
            "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
            aHolds ? tone.lit : "bg-fd-card",
          )}
        >
          <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
            <Timer className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            worker-a
          </code>
          <LeaseSlot held={aHolds} pending={pending} leaseLit={aHolds ? leaseLit : 0} />
          <p className="text-xs font-medium text-fd-foreground">
            {aHolds ? "lockedBy · inflight" : pending ? "waiting to claim" : "lease expired"}
          </p>
          <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            Claim sets <code className="font-mono text-[10px]">lockedBy</code> +{" "}
            <code className="font-mono text-[10px]">leaseExpiresAt</code>. Finish side effects
            before the lease ends — or another worker may reclaim while you still run.
          </p>
        </RevealItem>
        <RevealItem
          as="li"
          lift
          className={cn(
            "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
            bHolds ? tone.lit : "bg-fd-card",
          )}
        >
          <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
            <Timer className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            worker-b
          </code>
          <LeaseSlot held={bHolds} pending={false} leaseLit={bHolds ? 3 : 0} />
          <p className="text-xs font-medium text-fd-foreground">
            {bHolds ? "reclaimed · at-least-once" : "idle until lease expires"}
          </p>
          <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            Next claim query takes <code className="font-mono text-[10px]">pending</code> or expired{" "}
            <code className="font-mono text-[10px]">inflight</code>. Make the handler idempotent.
          </p>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}

function LeaseSlot({
  held,
  pending,
  leaseLit,
}: {
  readonly held: boolean;
  readonly pending: boolean;
  readonly leaseLit: number;
}) {
  return (
    <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
      <rect x="4" y="2" width="76" height="12" rx="2" fill={BOX} stroke={BOX_LINE} />
      <motion.circle
        cy="8"
        r="2.5"
        fill={PACKET}
        initial={false}
        animate={{
          cx: held ? 62 : pending ? 22 : 40,
          opacity: held || pending ? 0.95 : 0.2,
        }}
        transition={SPRING}
      />
      <motion.rect
        x="48"
        y="5"
        width="26"
        height="6"
        rx="1"
        fill={IDLE}
        initial={false}
        animate={{ opacity: held ? 0.35 : 0.08 }}
        transition={{ duration: 0.3 }}
      />
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={8 + i * 24}
          y="17"
          width="20"
          height="3"
          rx="1"
          fill={PACKET}
          initial={false}
          animate={{ opacity: i < leaseLit ? 0.9 : 0.15 }}
          transition={{ duration: 0.3 }}
        />
      ))}
    </svg>
  );
}

/* ─── live history replay ─────────────────────────────────────────────── */

const LIVE_PHASES = ["placed", "fulfilling", "shipped", "join", "replay"] as const;
const STATUS = ["placed", "fulfilling", "shipped"] as const;

/**
 * live retains every payload; a late bus.live() subscriber replays the full
 * history in order — not a firehose without memory.
 */
export function SignalLiveReplay() {
  const tick = useTick(1000);
  const phase = tick === null ? 4 : tick % LIVE_PHASES.length;
  const label = LIVE_PHASES[phase];
  // How many retained frames exist before join/replay
  const retained = phase <= 2 ? phase + 1 : 3;
  const joined = phase >= 3;
  const replaying = phase === 4;
  // During replay, light sinks in order; during join, sink present but empty-ish
  const sinkLit = replaying ? 3 : joined ? 0 : -1;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="live retains every payload; a late bus.live() subscriber replays the full history (placed → fulfilling → shipped)."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">live — retain, then replay</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          bus.live(&quot;order-status&quot;, …)
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          full history · unbounded retention today
        </span>
      </div>

      <RevealGroup as="div" className="flex flex-col gap-3 bg-fd-card px-4 py-4 sm:px-5">
        <RevealItem as="div" className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-fd-muted-foreground">retained stream</p>
          <ul className="flex flex-wrap gap-1.5">
            {STATUS.map((s, i) => {
              const on = i < retained;
              return (
                <li key={s}>
                  <motion.code
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] transition-colors duration-300",
                      on ? tone.active : "border-fd-border text-fd-muted-foreground",
                    )}
                    initial={false}
                    animate={{ opacity: on ? 1 : 0.35 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Activity
                      className={cn("size-3", on ? tone.icon : "text-fd-muted-foreground")}
                      aria-hidden
                      strokeWidth={1.75}
                    />
                    {s}
                  </motion.code>
                </li>
              );
            })}
          </ul>
        </RevealItem>

        <RevealItem as="div" className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-fd-muted-foreground">
            late subscriber {joined ? "· joined" : "· not connected"}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {STATUS.map((s, i) => {
              const on = sinkLit < 0 ? false : replaying ? i < sinkLit : false;
              // On join phase show empty slots; on replay fill them.
              const slot = joined;
              return (
                <li key={`sink-${s}`}>
                  <motion.code
                    className={cn(
                      "inline-flex min-w-18 items-center justify-center rounded border px-2 py-1 font-mono text-[10px] transition-colors duration-300",
                      on
                        ? tone.active
                        : slot
                          ? "border-dashed border-fd-border text-fd-muted-foreground"
                          : "border-fd-border/50 text-fd-muted-foreground/50",
                    )}
                    initial={false}
                    animate={{ opacity: slot ? (on ? 1 : 0.55) : 0.25 }}
                    transition={{ duration: 0.3, delay: on ? i * 0.08 : 0 }}
                  >
                    {on ? s : slot ? "…" : "—"}
                  </motion.code>
                </li>
              );
            })}
          </ul>
        </RevealItem>

        <RevealItem as="div">
          <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            Emits land in the retained stream even with no subscriber. A late{" "}
            <code className="font-mono text-[10px]">bus.live()</code> call replays every retained
            payload in order — then continues with new ones. Console monitor shows the newest 50 for
            display only.
          </p>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
