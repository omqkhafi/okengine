/**
 * Clock physics demos — claims that tables alone under-teach.
 *
 * - ClockCatchUp: health counts every missed slot; runtime fires once (`"one"`)
 * - ClockSleep: durable sleep journals wakeAt; restart resumes, does not lose place
 *
 * Same quality bar as StoreKvTtl / FlowTriggers: ambient tick phases, BeatPing,
 * reduced motion holds the end state. Deterministic — never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.orange;
const PACKET = "var(--oke-el-clock)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

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

/* ─── Catch-up "one" ──────────────────────────────────────────────────── */

/** Phases: miss slots accumulate → health reports catchUp → single fire. */
const CATCH_PHASES = [
  "miss",
  "miss",
  "miss",
  "miss",
  "miss",
  'catchUp: "one"',
  "fire ×1",
  "idle",
] as const;

/**
 * Downtime counts every missed hour; the runtime still fires the handler once.
 */
export function ClockCatchUp() {
  const tick = useTick(900);
  /* Reduced motion freezes the post-fire end state (missedRuns:5, one fire). */
  const phase = tick === null ? 7 : tick % CATCH_PHASES.length;
  const label = CATCH_PHASES[phase];
  const missed = phase < 5 ? phase + 1 : phase === 5 || phase === 6 || phase === 7 ? 5 : 0;
  const catchUpLit = phase >= 5;
  const fireLit = phase === 6;
  const fired = phase >= 6;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Catch-up policy one: an hourly clock down for five hours reports missedRuns five and catchUp one, then a single tick runs the handler once — never a storm of five."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">
          Catch-up — count every miss, fire once
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          catchUp: &quot;one&quot;
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null && phase < 7} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">hourly clock · five hours down</span>
      </div>

      <RevealGroup
        as="div"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
      >
        <RevealItem as="div" className="flex min-w-0 flex-col gap-3 bg-fd-card px-4 py-4 sm:px-5">
          <p className="text-[11px] text-fd-muted-foreground">Missed slots (health)</p>
          <ul className="flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }, (_, i) => {
              const on = i < missed;
              return (
                <li key={i}>
                  <code
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded border font-mono text-[10px] transition-colors duration-300",
                      on ? tone.active : "border-fd-border text-fd-muted-foreground/50",
                    )}
                  >
                    +{i + 1}
                  </code>
                </li>
              );
            })}
          </ul>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <div className="flex gap-1.5">
              <dt className="text-fd-muted-foreground/70">missedRuns</dt>
              <dd
                className={cn(
                  "transition-colors duration-300",
                  missed > 0 ? "text-fd-foreground" : "text-fd-muted-foreground",
                )}
              >
                {missed}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-fd-muted-foreground/70">catchUp</dt>
              <dd
                className={cn(
                  "transition-colors duration-300",
                  catchUpLit ? tone.mark : "text-fd-muted-foreground",
                )}
              >
                &quot;one&quot;
              </dd>
            </div>
          </dl>
        </RevealItem>

        <RevealItem as="div" className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
          <p className="text-[11px] text-fd-muted-foreground">Runtime fire</p>
          <CatchFireStrip fireLit={fireLit} fired={fired} tick={tick} />
          <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
            Five ghosts stay counted. The handler runs{" "}
            <span className="text-fd-foreground">once</span> when the lease is taken — not once per
            missed hour.
          </p>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}

function CatchFireStrip({
  fireLit,
  fired,
  tick,
}: {
  readonly fireLit: boolean;
  readonly fired: boolean;
  readonly tick: number | null;
}) {
  return (
    <svg viewBox="0 0 120 28" className="h-7 w-full max-w-56" role="presentation" aria-hidden>
      {/* Five ghost “would-have-fired” ticks — never light as real fires. */}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          cx={10 + i * 14}
          cy="14"
          r="3"
          fill="none"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity={0.7}
        />
      ))}
      <line x1="72" y1="14" x2="88" y2="14" stroke={BOX_LINE} strokeWidth="1" />
      <rect x="88" y="6" width="28" height="16" rx="3" fill={BOX} stroke={BOX_LINE} />
      <motion.circle
        cx="102"
        cy="14"
        r="4"
        fill={PACKET}
        initial={false}
        animate={{ opacity: fired ? 0.95 : 0.12, scale: fireLit ? 1.15 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      />
      {fireLit && tick !== null ? (
        <motion.circle
          key={tick}
          cx="72"
          cy="14"
          r="2.5"
          fill={PACKET}
          initial={{ cx: 72, opacity: 0 }}
          animate={{ cx: 102, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
        />
      ) : null}
      <text x="102" y="26" textAnchor="middle" fill={IDLE} fontSize="6" fontFamily="ui-monospace">
        ×1
      </text>
    </svg>
  );
}

/* ─── Durable sleep ───────────────────────────────────────────────────── */

const SLEEP_PHASES = ["sleep", "journal", "restart", "wake", "resume"] as const;

/**
 * Durable sleep journals wakeAt — a restart resumes at the sleep step, not from scratch.
 */
export function ClockSleep() {
  const tick = useTick(1100);
  /* Reduced motion freezes a completed resume after wake. */
  const phase = tick === null ? 4 : tick % SLEEP_PHASES.length;
  const label = SLEEP_PHASES[phase];

  const sleeping = phase >= 0 && phase < 3;
  const journaled = phase >= 1;
  const restarted = phase === 2;
  const awake = phase >= 3;
  const resumed = phase >= 4;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Durable sleep: fx.clock.sleep journals the wake time; after a restart the flow resumes at that step instead of losing its place."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Durable sleep — survives restart</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          sleep(&quot;wait-for-payment&quot;, &quot;7d&quot;)
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          durable: true · journaled wakeAt
        </span>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {(
          [
            {
              n: "01",
              title: "sleep",
              detail: 'fx.clock.sleep("wait-for-payment", "7d")',
              live: phase === 0,
              done: phase > 0,
              badge: null as string | null,
            },
            {
              n: "02",
              title: "journal",
              detail: "wakeAt + label written — Console shows the sleeping run",
              live: phase === 1,
              done: phase > 1,
              badge: journaled ? 'status: "sleeping"' : null,
            },
            {
              n: "03",
              title: "restart",
              detail: "Deploy / crash — process gone; journal stays",
              live: restarted,
              done: phase > 2,
              badge: restarted ? "SIGKILL" : null,
            },
            {
              n: "04",
              title: "wake → resume",
              detail: "Continue at the next unfinished step — prior steps never re-run",
              live: phase === 3 || phase === 4,
              done: false,
              badge: resumed ? "resumed" : awake ? "wakeAt" : null,
            },
          ] as const
        ).map((step) => (
          <RevealItem
            as="li"
            key={step.n}
            className={cn(
              "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
              step.live ? tone.lit : step.done ? "bg-fd-secondary/30" : "bg-fd-card",
            )}
          >
            <span className="relative flex w-8 shrink-0 items-center gap-1.5">
              <span className="font-mono text-[10px] text-fd-muted-foreground/70">{step.n}</span>
              {step.live && tick !== null ? (
                <span className="relative flex size-1.5" aria-hidden>
                  <BeatPing key={tick} className={tone.wash} />
                  <span className={cn("size-1.5 rounded-full", tone.hairline)} />
                </span>
              ) : (
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    step.done ? tone.hairline : "bg-fd-border",
                  )}
                  aria-hidden
                />
              )}
            </span>
            <p className="text-sm font-medium text-fd-foreground">{step.title}</p>
            <p className="min-w-0 flex-1 font-mono text-[10px] break-all text-fd-muted-foreground">
              {step.detail}
            </p>
            {step.badge ? (
              <code
                className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", tone.active)}
              >
                {step.badge}
              </code>
            ) : null}
          </RevealItem>
        ))}
      </RevealGroup>

      <div className="border-t border-fd-border px-4 py-3 sm:px-5">
        <SleepTimeline sleeping={sleeping} awake={awake} resumed={resumed} />
        <p className="mt-2 text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
          Non-durable flows resolve the same call immediately so tests read identically — durability
          is the option that journals.
        </p>
      </div>
    </figure>
  );
}

function SleepTimeline({
  sleeping,
  awake,
  resumed,
}: {
  readonly sleeping: boolean;
  readonly awake: boolean;
  readonly resumed: boolean;
}) {
  return (
    <svg viewBox="0 0 200 18" className="h-4 w-full max-w-sm" role="presentation" aria-hidden>
      <rect x="2" y="5" width="196" height="8" rx="2" fill={BOX} stroke={BOX_LINE} />
      <motion.rect
        x="6"
        y="7"
        width="40"
        height="4"
        rx="1"
        fill={PACKET}
        initial={false}
        animate={{ opacity: 0.9 }}
      />
      <motion.rect
        x="52"
        y="7"
        width="70"
        height="4"
        rx="1"
        fill={PACKET}
        initial={false}
        animate={{ opacity: sleeping ? 0.35 : awake ? 0.55 : 0.2 }}
        transition={{ duration: 0.3 }}
      />
      <text x="87" y="16" textAnchor="middle" fill={IDLE} fontSize="5.5" fontFamily="ui-monospace">
        7d sleep
      </text>
      <motion.rect
        x="128"
        y="7"
        width="64"
        height="4"
        rx="1"
        fill={PACKET}
        initial={false}
        animate={{ opacity: resumed ? 0.95 : awake ? 0.5 : 0.12 }}
        transition={{ duration: 0.3 }}
      />
    </svg>
  );
}
