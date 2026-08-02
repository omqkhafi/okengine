/**
 * AI guardrails — an fx.ask call is checked against each declared guardrail.
 *
 * Mode spotlight: each card takes a turn with a mini physics demo —
 * versioned prompts bump + evals, PII packet blocked at the build gate,
 * agent steps halt at maxSteps, prod driver slot fills from empty.
 * Deterministic from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { Eye, Gauge, Quote, ShieldBan, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.rose;
const ok = CHIP_TONE.emerald;

const PACKET = "var(--oke-el-ai)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const GUARDRAILS: ReadonlyArray<{
  readonly id: "versioned" | "pii" | "bounded" | "no-default";
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

const TICK_MS = 1300;

const VERDICT = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Four declared guardrails around fx.ask — cost and egress are contracts.
 */
export function AiGuardrails() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes on the PII block card — the guardrail doing its job. */
  const active = tick === null ? 1 : tick % GUARDRAILS.length;

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
              <GuardrailDemo kind={g.id} live={live} tick={tick} />
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

function GuardrailDemo({
  kind,
  live,
  tick,
}: {
  readonly kind: (typeof GUARDRAILS)[number]["id"];
  readonly live: boolean;
  readonly tick: number | null;
}) {
  if (kind === "versioned") return <VersionDemo live={live} tick={tick} />;
  if (kind === "pii") return <PiiDemo live={live} tick={tick} />;
  if (kind === "bounded") return <BoundDemo live={live} tick={tick} />;
  return <ProdDemo live={live} tick={tick} />;
}

/** Version chip bumps v1 → v2 → v3 while the card is live. */
function VersionDemo({ live, tick }: { readonly live: boolean; readonly tick: number | null }) {
  const version = !live || tick === null ? 3 : (tick % 3) + 1;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-hidden>
      {([1, 2, 3] as const).map((v) => (
        <motion.code
          key={v}
          initial={false}
          animate={{ opacity: v === version ? 1 : 0.35 }}
          transition={{ duration: 0.25 }}
          className={cn(
            VERDICT,
            v === version && live ? ok.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          v{v}
        </motion.code>
      ))}
    </div>
  );
}

/** Packet with a PII field hits the build gate and stops. */
function PiiDemo({ live, tick }: { readonly live: boolean; readonly tick: number | null }) {
  const blocked = live || tick === null;
  return (
    <svg viewBox="0 0 84 18" className="h-4 w-21" role="presentation" aria-hidden>
      <rect x="2" y="3" width="22" height="12" rx="2" fill={BOX} stroke={BOX_LINE} />
      <text
        x="13"
        y="12"
        textAnchor="middle"
        fill={IDLE}
        style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
      >
        email
      </text>
      <line x1="28" y1="9" x2="48" y2="9" stroke={BOX_LINE} strokeWidth="1" strokeDasharray="2 2" />
      <motion.circle
        key={live && tick !== null ? tick : "static"}
        cy="9"
        r="2.2"
        fill={PACKET}
        initial={false}
        animate={blocked ? { cx: 44, opacity: [0.2, 1, 0.15] } : { cx: 36, opacity: 0.5 }}
        transition={{ duration: 0.7, ease: "easeInOut" }}
      />
      <rect
        x="52"
        y="3"
        width="30"
        height="12"
        rx="2"
        fill={BOX}
        stroke={blocked ? "var(--color-rose-500)" : BOX_LINE}
        strokeOpacity={blocked ? 0.55 : 1}
      />
      <text
        x="67"
        y="12"
        textAnchor="middle"
        fill={blocked ? PACKET : IDLE}
        style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
      >
        block
      </text>
    </svg>
  );
}

/** Step chips climb; the last slot is the maxSteps halt. */
function BoundDemo({ live, tick }: { readonly live: boolean; readonly tick: number | null }) {
  const step = !live || tick === null ? 6 : (tick % 6) + 1;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-hidden>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <span
          key={n}
          className={cn(
            "size-1.5 rounded-full transition-colors duration-300",
            n <= step && live ? tone.hairline : n <= step ? ok.hairline : "bg-fd-border",
          )}
        />
      ))}
      <code className="ml-0.5 font-mono text-[10px] text-fd-muted-foreground">{step}/6</code>
    </div>
  );
}

/** Empty prod slot fills with a named driver when the card is live. */
function ProdDemo({ live, tick }: { readonly live: boolean; readonly tick: number | null }) {
  const filled = live || tick === null;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-hidden>
      <code className="rounded border border-fd-border px-1.5 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
        prod:
      </code>
      <motion.code
        key={filled ? "named" : "empty"}
        initial={false}
        animate={{ opacity: 1 }}
        className={cn(
          VERDICT,
          filled ? ok.active : "border-dashed border-fd-border text-fd-muted-foreground/50",
        )}
      >
        {filled ? "anthropic" : "—"}
      </motion.code>
    </div>
  );
}
