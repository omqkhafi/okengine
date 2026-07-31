/**
 * Gate evaluation pipeline — a request token traverses the stages.
 *
 * Most runs pass: the token lands on `do runs`. Every third run a gate denies
 * and the token lands on `Typed failure` instead, with the specific failure
 * (Unauthorized → Forbidden → RateLimited) cycling across denied runs.
 * Deterministic — beat and run derive from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const STAGES: ReadonlyArray<{
  readonly index: string;
  readonly title: string;
  readonly detail: string;
}> = [
  { index: "01", title: "Request / trigger", detail: "arrives at the trigger" },
  { index: "02", title: "Gates evaluate", detail: "policy · rate — first denial wins" },
  { index: "03", title: "Typed failure", detail: "returned, never thrown" },
  { index: "04", title: "do runs", detail: "only if every gate passed" },
];

const DENIALS = ["Unauthorized", "Forbidden", "RateLimited"] as const;

const TICK_MS = 950;
const BEATS_PER_RUN = 3;

const pass = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Permission sits at the trigger — a denied flow never touches fx.
 */
export function GatePipeline() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes a completed pass run (token on `do runs`). */
  const t = tick ?? 2;
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  const denied = run % 3 === 2;
  const denial = DENIALS[Math.floor(run / 3) % DENIALS.length];

  /* Where the token sits this beat: 01, then 02, then the outcome stage. */
  const tokenAt = beat === 0 ? 0 : beat === 1 ? 1 : denied ? 2 : 3;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Gate pipeline: a request reaches the trigger, gates evaluate before any store write or send, denial is a typed failure, and do runs only when all gates pass."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Gate before effect</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          .gate(member, fair)
        </code>
      </div>

      <RevealGroup
        as="ol"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-4"
      >
        {STAGES.map((s, i) => {
          const hasToken = i === tokenAt;
          const inTrail = i < tokenAt || (beat === 2 && i < tokenAt);
          const isOutcome = beat === 2 && i === tokenAt;
          const tone = isOutcome && denied ? fail : pass;
          return (
            <RevealItem
              as="li"
              key={s.index}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors duration-300 sm:px-5",
                hasToken ? tone.lit : inTrail ? "bg-fd-secondary/30" : "bg-fd-card",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-fd-muted-foreground/70">{s.index}</span>
                <p className="text-sm font-medium text-fd-foreground">{s.title}</p>
                <span className="relative ml-auto flex size-1.5 shrink-0" aria-hidden>
                  {hasToken && tick !== null ? <BeatPing key={t} className={tone.wash} /> : null}
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-300",
                      hasToken ? tone.hairline : "bg-fd-border",
                    )}
                  />
                </span>
              </div>
              {i === 2 ? (
                <div className="flex flex-wrap gap-1">
                  {DENIALS.map((d) => (
                    <motion.code
                      key={d}
                      animate={
                        isOutcome && denied && d === denial ? { scale: [1, 1.12, 1] } : { scale: 1 }
                      }
                      transition={{ duration: 0.4 }}
                      className={cn(
                        CHIP,
                        "transition-colors duration-300",
                        isOutcome && denied && d === denial
                          ? fail.active
                          : "border-fd-border text-fd-muted-foreground",
                      )}
                    >
                      {d}
                    </motion.code>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-pretty text-fd-muted-foreground">{s.detail}</p>
              )}
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
