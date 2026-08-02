/**
 * Four AI building blocks — model / prompt / embed / agent.
 *
 * Each card runs an ambient physics demo: a logical model binds to a provider,
 * a versioned prompt validates `out`, an embed packet lands in `store.index`,
 * an agent steps through tools via `fx.call` until `maxSteps`. Same quality bar
 * as StoreFacets / SignalDelivery. Deterministic — never Math.random.
 */

"use client";

import { MotionConfig, motion } from "framer-motion";
import { Bot, Braces, Layers, Sparkles, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const tone = CHIP_TONE.rose;

type BlockId = "model" | "prompt" | "embed" | "agent";

const BLOCKS: ReadonlyArray<{
  readonly id: BlockId;
  readonly icon: LucideIcon;
  readonly declare: string;
  readonly kind: string;
  readonly physics: string;
  readonly forUse: string;
}> = [
  {
    id: "model",
    icon: Sparkles,
    declare: 'ai.model("smart", { provider, tier })',
    kind: "Logical binding",
    physics: "Name → provider / tier — prod must declare the driver",
    forUse: "smart / fast / local — swap per environment",
  },
  {
    id: "prompt",
    icon: Braces,
    declare: 'smart.prompt("ticket-triage", { in, out, version })',
    kind: "Versioned artifact",
    physics: "fx.ask validates the response against `out`",
    forUse: "Typed triage, summaries, structured answers",
  },
  {
    id: "embed",
    icon: Layers,
    declare: 'ai.embed("kb", { into: index })',
    kind: "Embedding pipeline",
    physics: "Vectors land in store.index — searched via fx.search",
    forUse: "Knowledge base, semantic recall",
  },
  {
    id: "agent",
    icon: Bot,
    declare: 'ai.agent("support", { tools, maxSteps })',
    kind: "Bounded agent",
    physics: "Tools are flows — each step goes through fx.call",
    forUse: "Support cases, multi-step resolve with budgets",
  },
];

const PACKET = "var(--oke-el-ai)";
const IDLE = "var(--color-fd-muted-foreground)";
const BOX = "var(--color-fd-card)";
const BOX_LINE = "var(--color-fd-border)";

const TICK_MS = 1100;
const SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

/**
 * Four declaration kinds, one AI element — each with distinct physics.
 */
export function AiBlocks() {
  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Four AI building blocks — model bindings, versioned prompts, embedding pipelines into store.index, and bounded agents whose tools are flows."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Four blocks, one element</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          ai.model · prompt · embed · agent
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        {BLOCKS.map((b) => {
          const Icon = b.icon;
          return (
            <RevealItem
              as="li"
              lift
              key={b.id}
              className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-5"
            >
              <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
                {b.id}
              </code>
              <BlockDemo kind={b.id} />
              <p className="text-xs font-medium text-fd-foreground">{b.kind}</p>
              <code className="max-w-full font-mono text-[11px] break-all text-fd-muted-foreground">
                {b.declare}
              </code>
              <p className="text-xs text-pretty text-fd-muted-foreground">{b.physics}</p>
              <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {b.forUse}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}

function BlockDemo({ kind }: { readonly kind: BlockId }) {
  if (kind === "model") return <ModelDemo />;
  if (kind === "prompt") return <PromptDemo />;
  if (kind === "embed") return <EmbedDemo />;
  return <AgentDemo />;
}

const MODEL_PHASES = ["bind", "provider", "tier"] as const;

/** Model — logical name lights, then provider / tier bind in. */
function ModelDemo() {
  const tick = useTick(TICK_MS);
  const phase = tick === null ? 2 : tick % MODEL_PHASES.length;
  const label = MODEL_PHASES[phase];

  return (
    <div className="flex flex-col gap-1.5" aria-label="model binding demo">
      <PhaseChip label={label} live={tick !== null} tick={tick} />
      <div className="flex flex-wrap items-center gap-1" aria-hidden>
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
            tone.active,
          )}
        >
          smart
        </code>
        <span className="font-mono text-[10px] text-fd-muted-foreground/60">→</span>
        <motion.code
          initial={false}
          animate={{ opacity: phase >= 1 ? 1 : 0.25 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px]",
            phase >= 1 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          anthropic
        </motion.code>
        <motion.code
          initial={false}
          animate={{ opacity: phase >= 2 ? 1 : 0.25 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px]",
            phase >= 2 ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          opus
        </motion.code>
      </div>
    </div>
  );
}

const PROMPT_PHASES = ["ask", "validate", "out"] as const;

/** Prompt — ask → validate against out schema. */
function PromptDemo() {
  const tick = useTick(TICK_MS);
  const phase = tick === null ? 2 : tick % PROMPT_PHASES.length;
  const label = PROMPT_PHASES[phase];

  return (
    <div className="flex flex-col gap-1.5" aria-label="prompt validate demo">
      <PhaseChip label={label} live={tick !== null} tick={tick} />
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <rect x="4" y="3" width="28" height="16" rx="2" fill={BOX} stroke={BOX_LINE} />
        <text
          x="18"
          y="14"
          textAnchor="middle"
          fill={IDLE}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          v3
        </text>
        <line
          x1="36"
          y1="11"
          x2="48"
          y2="11"
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <motion.circle
          key={tick === null ? "static" : tick}
          cy="11"
          r="2.5"
          fill={PACKET}
          initial={false}
          animate={
            tick === null
              ? { cx: 56, opacity: 0.9 }
              : phase === 0
                ? { cx: 40, opacity: 0.95 }
                : phase === 1
                  ? { cx: 56, opacity: 0.95 }
                  : { cx: 70, opacity: 0.95 }
          }
          transition={SPRING}
        />
        <rect x="62" y="3" width="18" height="16" rx="2" fill={BOX} stroke={BOX_LINE} />
        <motion.text
          x="71"
          y="14"
          textAnchor="middle"
          initial={false}
          animate={{ fill: phase >= 2 ? PACKET : IDLE, opacity: phase >= 2 ? 1 : 0.45 }}
          style={{ fontSize: 6, fontFamily: "ui-monospace, monospace" }}
        >
          out
        </motion.text>
      </svg>
    </div>
  );
}

/** Embed — packet from model into store.index. */
function EmbedDemo() {
  const tick = useTick(1000);
  const reduced = useClientReducedMotion();
  const live = tick !== null;
  const emit = 10;
  const sink = 70;
  const y = 11;

  return (
    <div className="flex flex-col gap-1.5" aria-label="embed into index demo">
      <PhaseChip label="into" live={live} tick={tick} />
      <svg viewBox="0 0 84 22" className="h-5 w-21" role="presentation" aria-hidden>
        <rect x="2" y="4" width="20" height="14" rx="2" fill={BOX} stroke={BOX_LINE} />
        <text
          x="12"
          y="14"
          textAnchor="middle"
          fill={IDLE}
          style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
        >
          embed
        </text>
        <line
          x1={emit + 12}
          y1={y}
          x2={sink - 10}
          y2={y}
          stroke={BOX_LINE}
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <rect x="58" y="4" width="24" height="14" rx="2" fill={BOX} stroke={BOX_LINE} />
        <text
          x="70"
          y="14"
          textAnchor="middle"
          fill={IDLE}
          style={{ fontSize: 5.5, fontFamily: "ui-monospace, monospace" }}
        >
          index
        </text>
        <MotionConfig reducedMotion="never">
          <motion.circle
            key={live ? tick : "static"}
            cy={y}
            r="2.5"
            fill={PACKET}
            initial={false}
            animate={
              reduced || !live
                ? { cx: sink, opacity: 0.9 }
                : { cx: [emit + 12, sink - 10], opacity: [0, 1, 1, 0.9] }
            }
            transition={
              live && !reduced ? { duration: 0.85, ease: "easeInOut" } : { ...SPRING, duration: 0 }
            }
          />
        </MotionConfig>
      </svg>
    </div>
  );
}

const AGENT_TOOLS = ["getBooking", "refundBooking"] as const;

/** Agent — steps climb to maxSteps; each tool routes through fx.call. */
function AgentDemo() {
  const tick = useTick(900);
  /* Reduced motion freezes at step 3 of 6 with a tool lit. */
  const step = tick === null ? 3 : (tick % 7) + 1;
  const capped = Math.min(step, 6);
  const toolIdx = tick === null ? 0 : tick % AGENT_TOOLS.length;
  const halted = step > 6;

  return (
    <div className="flex flex-col gap-1.5" aria-label="agent maxSteps demo">
      <PhaseChip
        label={halted ? "maxSteps" : `step ${capped}/6`}
        live={tick !== null}
        tick={tick}
      />
      <div className="flex flex-wrap items-center gap-1" aria-hidden>
        {AGENT_TOOLS.map((tool, i) => (
          <motion.code
            key={tool}
            initial={false}
            animate={{
              opacity: !halted && i === toolIdx ? 1 : 0.4,
            }}
            transition={{ duration: 0.25 }}
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px]",
              !halted && i === toolIdx ? tone.active : "border-fd-border text-fd-muted-foreground",
            )}
          >
            {tool}
          </motion.code>
        ))}
        <span className="font-mono text-[10px] text-fd-muted-foreground/60">→</span>
        <code
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px]",
            !halted ? tone.active : "border-fd-border text-fd-muted-foreground",
          )}
        >
          fx.call
        </code>
      </div>
    </div>
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
