/**
 * AI PII egress — same `.pii()` field on fx.ask, opposite physics by provider.
 *
 * Phase strip walks ask → check → verdict (VaultRedacted pattern). Left card:
 * anthropic is third-party egress → AiPiiBuildError without allowPii. Right card:
 * openai-compatible (and mock / local) is on-premise → ask proceeds. Footer holds
 * “Checking egress…” until the verdict beat. Deterministic — never Math.random.
 */

"use client";

import { MotionConfig, motion } from "framer-motion";
import { Cloud, Server, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const tone = CHIP_TONE.rose;
const ok = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

const PHASES = ["ask", "check", "verdict"] as const;

const TICK_MS = 1100;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

const PACKET = "var(--oke-el-ai)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * Same PII field, opposite egress physics — third-party fails; local proceeds.
 */
export function AiPiiEgress() {
  const reduced = useClientReducedMotion();
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes on the verdict beat. */
  const phase = tick === null ? 2 : tick % PHASES.length;
  const decided = phase >= 2;
  const footerLabel = !decided ? "Checking egress…" : "Same field — provider decides the physics";

  return (
    <MotionConfig reducedMotion="never">
      <figure
        className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
        aria-label="PII egress physics: sending a .pii() field to anthropic fails the build without allowPii; the same ask against openai-compatible local is on-premise and proceeds."
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
          <p className="text-sm font-medium text-fd-foreground">
            PII — same field, opposite egress
          </p>
          <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
            fx.ask · .pii() · email
          </code>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
          {PHASES.map((p, i) => (
            <PhaseChip key={p} label={p} live={phase === i} tick={tick} dim={phase !== i} />
          ))}
          <span className="text-[11px] text-fd-muted-foreground">
            {reduced ? "static — verdict freeze" : "shared beat — third-party vs local"}
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
            tick={tick}
          />
          <EgressCard
            icon={Server}
            driver="openai-compatible"
            headline="On-premise — ask proceeds"
            detail="mock, local, and openai-compatible are not third-party egress."
            phase={phase}
            blocked={false}
            outcome="ask proceeds · no AiPiiBuildError"
            tick={tick}
          />
        </RevealGroup>

        <div
          className={cn(
            "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-fd-border px-4 py-2.5 transition-colors duration-300 sm:px-5",
            decided ? "bg-fd-secondary/40" : "bg-fd-secondary/50",
          )}
        >
          <span className="w-5 shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">→</span>
          <p className="min-w-0 text-xs font-medium text-fd-foreground">{footerLabel}</p>
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[10px] transition-opacity duration-300",
              decided ? tone.mark : "opacity-0",
            )}
          >
            {decided ? "isThirdParty(provider)" : "·"}
          </span>
        </div>
      </figure>
    </MotionConfig>
  );
}

function PhaseChip({
  label,
  live,
  tick,
  dim,
}: {
  readonly label: string;
  readonly live: boolean;
  readonly tick: number | null;
  readonly dim: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <code
        className={cn(
          CHIP,
          "transition-colors duration-300",
          live
            ? tone.active
            : dim
              ? "border-fd-border text-fd-muted-foreground/50"
              : "border-fd-border text-fd-muted-foreground",
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
  tick,
}: {
  readonly icon: LucideIcon;
  readonly driver: string;
  readonly headline: string;
  readonly detail: string;
  readonly phase: number;
  readonly blocked: boolean;
  readonly outcome: string;
  readonly tick: number | null;
}) {
  const checking = phase >= 1;
  const decided = phase >= 2;
  const outcomeTone = blocked ? fail : ok;
  /* Packet stops at the gate when blocked; lands in the sink when allowed. */
  const cx = !checking ? 28 : decided ? (blocked ? 44 : 70) : 44;

  return (
    <RevealItem as="li" lift className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
      <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
        <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
        {driver}
      </code>

      <svg viewBox="0 0 96 22" className="h-5 w-full max-w-24" role="presentation" aria-hidden>
        <rect x="2" y="3" width="24" height="16" rx="2" fill={BOX} stroke={BOX_LINE} />
        <text
          x="14"
          y="14"
          textAnchor="middle"
          fill={IDLE}
          style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
        >
          email
        </text>
        <line
          x1="30"
          y1="11"
          x2="48"
          y2="11"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <rect
          x="50"
          y="3"
          width="20"
          height="16"
          rx="2"
          fill={BOX}
          stroke={checking ? (blocked && decided ? "var(--color-rose-500)" : BOX_LINE) : BOX_LINE}
          strokeOpacity={blocked && decided ? 0.55 : 1}
        />
        <text
          x="60"
          y="14"
          textAnchor="middle"
          fill={checking ? (blocked && decided ? PACKET : IDLE) : IDLE}
          style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
        >
          gate
        </text>
        <line
          x1="74"
          y1="11"
          x2="78"
          y2="11"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity={blocked ? 0.25 : 1}
        />
        <rect
          x="80"
          y="3"
          width="14"
          height="16"
          rx="2"
          fill={BOX}
          stroke={BOX_LINE}
          opacity={blocked ? 0.35 : 1}
        />
        <text
          x="87"
          y="14"
          textAnchor="middle"
          fill={decided && !blocked ? PACKET : IDLE}
          opacity={blocked ? 0.35 : 1}
          style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
        >
          ask
        </text>
        <motion.circle
          key={tick === null ? "static" : `${tick}-${blocked ? "b" : "a"}`}
          cy="11"
          r="2.4"
          fill={PACKET}
          initial={false}
          animate={{ cx, opacity: phase === 0 ? 0.95 : decided && blocked ? 0.35 : 0.95 }}
          transition={SPRING}
        />
      </svg>

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
            isThirdParty({driver === "anthropic" ? '"anthropic"' : '"openai-compatible"'})
          </code>
          <span
            className={cn(
              "font-mono text-[10px]",
              decided ? outcomeTone.mark : checking ? tone.mark : "text-fd-muted-foreground/40",
            )}
          >
            {decided ? (blocked ? "true → block" : "false → allow") : checking ? "…" : "·"}
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
