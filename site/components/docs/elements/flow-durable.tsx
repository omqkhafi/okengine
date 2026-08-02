/**
 * Durable journal physics — kill mid-run, resume without re-charging.
 *
 * Contrast cards share one beat: create-intent → killed → resume/restart →
 * confirm. With `durable: true`, the journal skips the completed step so
 * create-intent stays ×1. Without a journal, a restart re-runs it (×2).
 * Verified by the engine durable journal suite. Deterministic — never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { BookMarked, ZapOff, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.sky;
const ok = CHIP_TONE.emerald;
const warn = CHIP_TONE.rose;

const PHASES = ["create-intent", "killed", "resume", "confirm"] as const;

const TICK_MS = 1100;

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Same charge flow, opposite resume physics — journaled steps never re-run.
 */
export function FlowDurable() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes on the completed confirm beat. */
  const phase = tick === null ? 3 : tick % PHASES.length;
  const label = PHASES[phase];

  const durableIntent = 1;
  const durableConfirm = phase >= 3 ? 1 : 0;
  const bareIntent = phase >= 2 ? 2 : 1;
  const bareConfirm = phase >= 3 ? 1 : 0;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Durable journal physics: with durable true, killing the process after create-intent resumes at confirm and create-intent never re-runs; without a journal, a restart re-runs create-intent."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">
          Kill mid-run — same steps, opposite resume
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          durable: true · fx.step
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          shared beat · create-intent → kill → resume → confirm
        </span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <ResumeCard
          icon={BookMarked}
          declare="durable: true"
          headline="Journal resume"
          detail="Completed steps replay from the journal — create-intent never re-runs."
          intentCount={durableIntent}
          confirmCount={durableConfirm}
          phase={phase}
          mode="durable"
          outcome="create-intent ×1 · no double charge"
          outcomeTone={ok}
        />
        <ResumeCard
          icon={ZapOff}
          declare="durable: false"
          headline="Restart from scratch"
          detail="No journal — the run is lost. A retry re-enters create-intent."
          intentCount={bareIntent}
          confirmCount={bareConfirm}
          phase={phase}
          mode="bare"
          outcome="create-intent ×2 · double-charge risk"
          outcomeTone={warn}
        />
      </RevealGroup>
    </figure>
  );
}

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
          CHIP,
          "transition-colors duration-300",
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

function ResumeCard({
  icon: Icon,
  declare,
  headline,
  detail,
  intentCount,
  confirmCount,
  phase,
  mode,
  outcome,
  outcomeTone,
}: {
  readonly icon: LucideIcon;
  readonly declare: string;
  readonly headline: string;
  readonly detail: string;
  readonly intentCount: number;
  readonly confirmCount: number;
  readonly phase: number;
  readonly mode: "durable" | "bare";
  readonly outcome: string;
  readonly outcomeTone: (typeof CHIP_TONE)[keyof typeof CHIP_TONE];
}) {
  const intentMark: StepMark =
    phase === 0
      ? "running"
      : phase === 1
        ? mode === "durable"
          ? "journaled"
          : "done"
        : mode === "durable"
          ? "skipped"
          : "rerun";
  const killLit = phase === 1;
  const confirmMark: StepMark = phase >= 3 ? "running" : phase === 2 ? "pending" : "idle";

  return (
    <RevealItem as="li" lift className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
      <code className="inline-flex w-fit max-w-full items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-[11px] break-all text-fd-foreground">
        <Icon className={cn("size-3 shrink-0", tone.icon)} aria-hidden strokeWidth={1.75} />
        {declare}
      </code>

      <ol className="flex flex-col gap-1">
        <StepRow
          name="create-intent"
          mark={intentMark}
          lit={phase === 0 || (mode === "bare" && phase === 2)}
        />
        <StepRow name="process killed" mark={killLit ? "killed" : "idle"} lit={killLit} />
        <StepRow name="confirm" mark={confirmMark} lit={phase === 3} />
      </ol>

      <div className="flex flex-wrap gap-1.5" aria-hidden>
        <CountChip label="create-intent" count={intentCount} hot={intentCount > 1} />
        <CountChip label="confirm" count={confirmCount} hot={false} />
      </div>

      <p className="text-xs font-medium text-fd-foreground">{headline}</p>
      <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">{detail}</p>
      <motion.code
        initial={false}
        animate={{ opacity: phase >= 3 ? 1 : 0.35 }}
        transition={{ duration: 0.3 }}
        className={cn(
          CHIP,
          "mt-auto w-fit",
          phase >= 3 ? outcomeTone.active : "border-fd-border text-fd-muted-foreground",
        )}
      >
        {outcome}
      </motion.code>
    </RevealItem>
  );
}

type StepMark =
  | "running"
  | "done"
  | "journaled"
  | "skipped"
  | "rerun"
  | "killed"
  | "pending"
  | "idle";

function StepRow({
  name,
  mark,
  lit,
}: {
  readonly name: string;
  readonly mark: StepMark;
  readonly lit: boolean;
}) {
  const markTone =
    mark === "killed" || mark === "rerun"
      ? warn
      : mark === "skipped" || mark === "done" || mark === "journaled" || mark === "running"
        ? ok
        : tone;

  const label =
    mark === "running"
      ? "running"
      : mark === "done"
        ? "done"
        : mark === "journaled"
          ? "journaled"
          : mark === "skipped"
            ? "skipped"
            : mark === "rerun"
              ? "re-ran"
              : mark === "killed"
                ? "KILLED"
                : mark === "pending"
                  ? "next"
                  : "·";

  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 transition-colors duration-300",
        lit ? markTone.active : "border-fd-border bg-fd-secondary/20",
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-fd-foreground">
        {name}
      </code>
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] transition-opacity duration-300",
          mark === "idle" ? "opacity-30 text-fd-muted-foreground" : markTone.mark,
        )}
      >
        {label}
      </span>
    </li>
  );
}

function CountChip({
  label,
  count,
  hot,
}: {
  readonly label: string;
  readonly count: number;
  readonly hot: boolean;
}) {
  return (
    <code className={cn(CHIP, hot ? warn.active : "border-fd-border text-fd-muted-foreground")}>
      {label} ×{count}
    </code>
  );
}
