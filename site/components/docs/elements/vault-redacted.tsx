/**
 * Redacted until reveal — fx.vault wraps the value so logs and serialization
 * never see cleartext; only `.reveal()` yields the credential at the provider
 * boundary. Shared beat across both cards (StoreKvTtl pattern). Deterministic
 * from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { Eye, Shield, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.yellow;
const ok = CHIP_TONE.emerald;

const TICK_MS = 1100;
const PHASES = ["vault", "log", "json", "reveal"] as const;

/**
 * Same `fx.vault` read — hold the Redacted (safe) vs `.reveal()` at the edge.
 */
export function VaultRedacted() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes the reveal beat — cleartext only at the boundary. */
  const phase = tick === null ? 3 : tick % PHASES.length;
  const label = PHASES[phase];

  const masked = phase < 3;
  const revealed = phase === 3;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Vault Redacted physics: fx.vault returns a Redacted wrapper so fx.log, String, and JSON show [redacted]; only .reveal() yields cleartext at the provider boundary."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Redacted until you reveal</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          fx.vault(secret) → Redacted
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        <PhaseChip label={label} live={tick !== null} tick={tick} />
        <span className="text-[11px] text-fd-muted-foreground">shared beat — hold vs reveal</span>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2"
      >
        <PathCard
          icon={Shield}
          title="hold Redacted"
          syntax="fx.vault(stripeKey)"
          live={masked}
          outcome="[redacted]"
          detail="fx.log, String(), and JSON.stringify never see the value — nested Redacted included."
          sinks={[
            { id: "log", label: "fx.log", active: phase === 1, value: "[redacted]" },
            { id: "json", label: "JSON / String", active: phase === 2, value: "[redacted]" },
          ]}
          tick={tick}
        />
        <PathCard
          icon={Eye}
          title="reveal at boundary"
          syntax="key.reveal()"
          live={revealed}
          outcome="sk_test_…"
          detail="One explicit call at the Stripe (or SMTP, or SDK) edge — the credential crosses only there."
          sinks={[
            {
              id: "provider",
              label: "stripe(…).create",
              active: revealed,
              value: "sk_test_…",
              clear: true,
            },
          ]}
          tick={tick}
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

function PathCard({
  icon: Icon,
  title,
  syntax,
  live,
  outcome,
  detail,
  sinks,
  tick,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly syntax: string;
  readonly live: boolean;
  readonly outcome: string;
  readonly detail: string;
  readonly sinks: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly active: boolean;
    readonly value: string;
    readonly clear?: boolean;
  }>;
  readonly tick: number | null;
}) {
  return (
    <RevealItem
      as="li"
      lift
      className={cn(
        "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
        live ? tone.lit : "bg-fd-card",
      )}
    >
      <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
        <Icon className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
        {title}
      </code>
      <code className="font-mono text-[11px] text-fd-muted-foreground">{syntax}</code>

      <ul className="flex flex-col gap-1.5">
        {sinks.map((sink) => (
          <li
            key={sink.id}
            className={cn(
              "flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-colors duration-300",
              sink.active
                ? sink.clear
                  ? ok.active
                  : tone.active
                : "border-fd-border bg-fd-secondary/30",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="relative flex size-1.5 shrink-0" aria-hidden>
                {sink.active && tick !== null ? (
                  <BeatPing
                    key={`${sink.id}-${tick}`}
                    className={sink.clear ? ok.wash : tone.wash}
                  />
                ) : null}
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    sink.active ? (sink.clear ? ok.hairline : tone.hairline) : "bg-fd-border",
                  )}
                />
              </span>
              <code className="min-w-0 font-mono text-[10px] text-fd-foreground">{sink.label}</code>
            </span>
            <motion.code
              key={`${sink.id}-${sink.active ? sink.value : "idle"}`}
              initial={tick === null ? false : { opacity: 0.4 }}
              animate={{ opacity: sink.active ? 1 : 0.45 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "shrink-0 font-mono text-[10px]",
                sink.active ? (sink.clear ? ok.mark : tone.mark) : "text-fd-muted-foreground/50",
              )}
            >
              {sink.active ? sink.value : "·"}
            </motion.code>
          </li>
        ))}
      </ul>

      <p className="text-xs font-medium text-fd-foreground">
        shows <code className="font-mono text-[11px]">{outcome}</code>
      </p>
      <p className="mt-auto text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
        {detail}
      </p>
    </RevealItem>
  );
}
