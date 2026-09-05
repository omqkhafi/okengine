/**
 * AI guardrails — an fx.ask must clear declared contracts.
 *
 * Each run walks version → PII → budget/steps → prod driver. Four scenarios
 * cycle: clean ask (all pass), PII build gate deny, maxSteps/budget halt, and
 * missing prod driver. Later stages skip after a denial. Footer stays on
 * “Checking…” until the outcome beat (GatePipeline pattern). Deterministic
 * from one tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const STAGES: ReadonlyArray<{
  readonly id: "versioned" | "pii" | "bounded" | "driver";
  readonly title: string;
  readonly detail: string;
}> = [
  {
    id: "versioned",
    title: "versioned prompt",
    detail: 'smart.prompt("ticket-triage", { version: 1, out })',
  },
  {
    id: "pii",
    title: "PII build gate",
    detail: "third-party + .pii() field → needs allowPii",
  },
  {
    id: "bounded",
    title: "steps · budget",
    detail: "maxSteps: 6 · budget.maxCostPerRun",
  },
  {
    id: "driver",
    title: "prod driver",
    detail: "drivers.ai.prod must be named — no default",
  },
];

const SCENARIOS: ReadonlyArray<{
  readonly label: string;
  readonly denyAt: number;
  readonly code: string | null;
  readonly mark: string;
}> = [
  {
    label: "clean ask",
    denyAt: -1,
    code: null,
    mark: "fx.ask returns",
  },
  {
    label: "PII to anthropic",
    denyAt: 1,
    code: "AiPiiBuildError",
    mark: "field(s) [email]",
  },
  {
    label: "runaway agent",
    denyAt: 2,
    code: "AiBudgetExceededError",
    mark: "maxCostPerRun",
  },
  {
    label: "prod unset",
    denyAt: 3,
    code: "no prod default",
    mark: "declare drivers.ai",
  },
];

const TICK_MS = 850;
const BEATS_PER_RUN = 5;

const pass = CHIP_TONE.emerald;
const probe = CHIP_TONE.rose;
const fail = CHIP_TONE.rose;

/**
 * Declared guardrails around fx.ask — cost and egress are contracts.
 */
export function AiGuardrails() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes the PII deny run on its outcome beat. */
  const t = tick ?? 1 * BEATS_PER_RUN + (BEATS_PER_RUN - 1);
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  const scenario = SCENARIOS[run % SCENARIOS.length]!;
  const { label, denyAt, code, mark } = scenario;
  const outcomeLive = beat === BEATS_PER_RUN - 1;
  const footerLabel = !outcomeLive
    ? "Checking guardrails…"
    : code === null
      ? "Every contract cleared — ask proceeds"
      : "Blocked — violated contract, not a soft warn";

  return (
    <figure
      className="not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="AI guardrails chain: versioned prompt, PII build gate, maxSteps and budget, then prod driver. First denial wins — AiPiiBuildError without allowPii, AiBudgetExceededError on runaway cost, or missing prod driver. Later stages are skipped. fx.ask proceeds only when every contract cleared."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">
          Guardrails — contracts, not guidelines
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.ask(prompt, input)
        </code>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fd-border px-4 py-2 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
          scenario
        </span>
        <code className="font-mono text-[11px] text-fd-foreground">{label}</code>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {STAGES.map((stage, i) => {
          const probing = beat < 4 && i === beat && (denyAt === -1 || beat <= denyAt);
          const passed = (denyAt === -1 || i < denyAt) && beat > i;
          const denied = i === denyAt && beat > denyAt;
          const skipped = denyAt !== -1 && i > denyAt && beat > denyAt;
          return (
            <RevealItem
              as="li"
              key={stage.id}
              className={cn(
                "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
                denied
                  ? fail.lit
                  : passed
                    ? pass.lit
                    : probing
                      ? "bg-fd-secondary/40"
                      : "bg-fd-card",
              )}
            >
              <span className="relative flex w-8 shrink-0 items-center gap-1.5">
                <span className="w-2.5 font-mono text-[10px] text-fd-muted-foreground/70">
                  {i + 1}
                </span>
                {probing && tick !== null ? (
                  <span className="relative flex size-1.5" aria-hidden>
                    <BeatPing key={t} className={probe.wash} />
                    <span className={cn("size-1.5 rounded-full", probe.hairline)} />
                  </span>
                ) : passed || denied ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", denied ? fail.hairline : pass.hairline)}
                  />
                ) : skipped ? (
                  <span aria-hidden className="size-1.5 rounded-full bg-fd-muted-foreground/25" />
                ) : (
                  <span aria-hidden className="size-1.5 rounded-full border border-fd-border" />
                )}
              </span>
              <code className="min-w-0 font-mono text-[11px] break-all text-fd-foreground">
                {stage.title}
              </code>
              <span className="min-w-0 text-[11px] text-fd-muted-foreground">{stage.detail}</span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto font-mono text-[10px] transition-opacity duration-300",
                  denied
                    ? fail.mark
                    : passed
                      ? pass.mark
                      : skipped
                        ? "text-fd-muted-foreground/40"
                        : "opacity-0",
                )}
              >
                {denied ? "✗ deny" : passed ? "✓ pass" : skipped ? "skipped" : "·"}
              </span>
            </RevealItem>
          );
        })}
        <RevealItem
          as="li"
          className={cn(
            "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
            outcomeLive ? (code === null ? pass.lit : fail.lit) : "bg-fd-secondary/50",
          )}
        >
          <span className="w-5 shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">→</span>
          <p className="min-w-0 text-xs font-medium text-fd-foreground">{footerLabel}</p>
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[10px] transition-opacity duration-300",
              outcomeLive ? (code === null ? pass.mark : fail.mark) : "opacity-0",
            )}
          >
            {outcomeLive ? (code === null ? mark : `${code} · ${mark}`) : "·"}
          </span>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
