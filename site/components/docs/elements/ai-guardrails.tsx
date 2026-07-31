/**
 * AI guardrails — an fx.ask call is checked against each declared guardrail.
 *
 * The spotlight hops one guardrail per beat and the verdict lands with it:
 * evals pass, the PII gate blocks, budget holds, the prod driver is declared.
 * The PII card always shows the block — that is the guardrail doing its job.
 * Deterministic from one tick, never Math.random.
 */

"use client";

import { Eye, Gauge, Quote, ShieldBan, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.rose;
const ok = CHIP_TONE.emerald;

const GUARDRAILS: ReadonlyArray<{
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
  readonly verdict: string;
  readonly blocks: boolean;
}> = [
  {
    id: "versioned",
    icon: Quote,
    title: "Versioned prompts",
    detail: "Artifacts with typed in/out — diffs and evals per version, not strings in a handler",
    verdict: "evals pass ✓",
    blocks: false,
  },
  {
    id: "pii",
    icon: ShieldBan,
    title: "PII build gate",
    detail: "Third-party model + .pii() field → build fails unless allowPii is explicit",
    verdict: "build failed ✗",
    blocks: true,
  },
  {
    id: "bounded",
    icon: Gauge,
    title: "Bounded agents",
    detail: "maxSteps + budget.maxCostPerRun — a runaway is a violated contract",
    verdict: "within budget ✓",
    blocks: false,
  },
  {
    id: "no-default",
    icon: Eye,
    title: "No prod default",
    detail: "prod must name a driver in oke.config.ts — model choice is reviewable",
    verdict: "prod declared ✓",
    blocks: false,
  },
];

const TICK_MS = 1200;

const VERDICT = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Four declared guardrails around fx.ask — cost and egress are contracts.
 */
export function AiGuardrails() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % GUARDRAILS.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="AI guardrails: prompts are versioned typed artifacts, PII to third-party models fails the build unless acknowledged, agents are bounded by steps and budget, and there is no production model default."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Declared guardrails</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.ask(prompt, input)
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[32rem]:grid-cols-2 @min-[56rem]:grid-cols-4"
      >
        {GUARDRAILS.map((g, i) => {
          const Icon = g.icon;
          const live = i === active;
          const verdictTone = g.blocks ? tone : ok;
          return (
            <RevealItem
              as="li"
              lift
              key={g.id}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors duration-300 sm:px-5",
                live ? (g.blocks ? tone.lit : ok.lit) : "bg-fd-card hover:bg-fd-secondary/40",
              )}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-fd-foreground">
                <span className="relative flex size-3.5 shrink-0" aria-hidden>
                  {live && tick !== null ? (
                    <BeatPing key={tick} className={verdictTone.wash} />
                  ) : null}
                  <Icon
                    className={cn(
                      "size-3.5 transition-colors duration-300",
                      live ? verdictTone.icon : "text-fd-muted-foreground",
                    )}
                    aria-hidden
                    strokeWidth={1.75}
                  />
                </span>
                {g.title}
              </p>
              <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                {g.detail}
              </p>
              <p className="mt-auto flex min-h-5 items-center pt-0.5" aria-hidden>
                <code
                  className={cn(
                    VERDICT,
                    "transition-opacity duration-300",
                    live ? verdictTone.active : "opacity-0",
                  )}
                >
                  {g.verdict}
                </code>
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
