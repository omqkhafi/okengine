/**
 * AI physics demos — claims that tables alone under-teach.
 *
 * AiPiiEgress: same `.pii()` field on fx.ask — anthropic (third-party) fails
 * the build; openai-compatible local (on-premise) proceeds. Mirrors
 * assertAllowPiiForAsk in src/elements/ai/pii.ts. Deterministic — never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { Cloud, Server, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.rose;
const ok = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

const PHASES = ["ask", "check", "verdict"] as const;

const TICK_MS = 1100;

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Same PII field, opposite egress physics — third-party fails; local proceeds.
 */
export function AiPiiEgress() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes on the verdict beat. */
  const phase = tick === null ? 2 : tick % PHASES.length;
  const label = PHASES[phase];

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="PII egress physics: sending a .pii() field to anthropic fails the build without allowPii; the same ask against openai-compatible local is on-premise and proceeds."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">PII — same field, opposite egress</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.ask · .pii() · email
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">
          shared beat · ask → build check → verdict
        </span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <EgressCard
          icon={Cloud}
          driver="anthropic"
          headline="Third-party — build fails"
          detail="Cloud provider counts as egress. Without allowPii the build stops before deploy."
          phase={phase}
          blocked
          outcome="AiPiiBuildError · field(s) [email]"
        />
        <EgressCard
          icon={Server}
          driver="openai-compatible"
          headline="On-premise — ask proceeds"
          detail="mock, local, and openai-compatible are not third-party egress."
          phase={phase}
          blocked={false}
          outcome="ask proceeds · no AiPiiBuildError"
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

function EgressCard({
  icon: Icon,
  driver,
  headline,
  detail,
  phase,
  blocked,
  outcome,
}: {
  readonly icon: LucideIcon;
  readonly driver: string;
  readonly headline: string;
  readonly detail: string;
  readonly phase: number;
  readonly blocked: boolean;
  readonly outcome: string;
}) {
  const checking = phase >= 1;
  const decided = phase >= 2;
  const outcomeTone = blocked ? fail : ok;

  return (
    <RevealItem as="li" lift className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
      <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
        <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
        {driver}
      </code>

      <ol className="flex flex-col gap-1" aria-hidden>
        <li
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors duration-300",
            phase === 0 ? tone.active : "border-fd-border bg-fd-secondary/20",
          )}
        >
          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-fd-foreground">
            {"ask({ email })"}
          </code>
          <span
            className={cn(
              "font-mono text-[10px]",
              phase === 0 ? tone.mark : "text-fd-muted-foreground/50",
            )}
          >
            .pii()
          </span>
        </li>
        <li
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors duration-300",
            checking && phase === 1
              ? tone.active
              : decided
                ? outcomeTone.active
                : "border-fd-border bg-fd-secondary/20",
          )}
        >
          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-fd-foreground">
            build PII check
          </code>
          <span
            className={cn(
              "font-mono text-[10px]",
              decided ? outcomeTone.mark : checking ? tone.mark : "text-fd-muted-foreground/40",
            )}
          >
            {decided ? (blocked ? "block" : "allow") : checking ? "…" : "·"}
          </span>
        </li>
      </ol>

      <p className="text-xs font-medium text-fd-foreground">{headline}</p>
      <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">{detail}</p>
      <motion.code
        initial={false}
        animate={{ opacity: decided ? 1 : 0.3 }}
        transition={{ duration: 0.3 }}
        className={cn(
          CHIP,
          "mt-auto w-fit max-w-full break-all",
          decided ? outcomeTone.active : "border-fd-border text-fd-muted-foreground",
        )}
      >
        {outcome}
      </motion.code>
    </RevealItem>
  );
}
