/**
 * Vault resolution chain — a probe descends the layers until first hit.
 *
 * Layer ids match `VaultResolutionSource`: driver → process.env →
 * .env.local → dev-fallback. Each run probes one layer per beat;
 * the hit layer cycles 0→1→2→3 across runs, and every fifth run
 * misses all four so the fail row lights. Layers past the hit read
 * `skipped` — that is the whole semantics of "first hit wins".
 * Footer stays on “Resolving…” until the outcome beat (GatePipeline
 * pattern). Deterministic from one tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

/** Spec order from vault runtime — source ids are the Console labels. */
const LAYERS: ReadonlyArray<{
  readonly source: string;
  readonly content: string;
}> = [
  { source: "driver", content: "Built-in vault / managed bag" },
  { source: "process.env", content: "Real env (CI, hosting)" },
  { source: ".env.local", content: "Local overrides (gitignored)" },
  { source: "dev-fallback", content: "dev: on the contract — never in prod" },
];

/** One contract probe per run — value only appears when a layer wins. */
const RUNS: ReadonlyArray<{
  readonly contract: string;
  readonly hitAt: number;
  readonly valueHint: string;
}> = [
  { contract: "STRIPE_KEY", hitAt: 0, valueHint: "from driver" },
  { contract: "STRIPE_KEY", hitAt: 1, valueHint: "from process.env" },
  { contract: "STRIPE_KEY", hitAt: 2, valueHint: "from .env.local" },
  { contract: "STRIPE_KEY", hitAt: 3, valueHint: "from dev:" },
  { contract: "STRIPE_KEY", hitAt: -1, valueHint: "—" },
];

const TICK_MS = 850;
const BEATS_PER_RUN = 5;

const probe = CHIP_TONE.yellow;
const hit = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

/**
 * Layered resolution with a fail-loud bottom — VaultBootError, not a halfway boot.
 */
export function VaultResolution() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes a hit on `.env.local` (run index 2, outcome beat). */
  const t = tick ?? 2 * BEATS_PER_RUN + 4;
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  const scenario = RUNS[run % RUNS.length]!;
  const { contract, hitAt, valueHint } = scenario;
  const outcomeLive = beat === BEATS_PER_RUN - 1;
  const resolved = hitAt !== -1 && outcomeLive;
  const failed = hitAt === -1 && outcomeLive;
  const footerLabel = !outcomeLive
    ? "Resolving chain…"
    : resolved
      ? `First hit wins — ${valueHint}`
      : "All miss — boot fails loud, every gap listed";

  return (
    <figure
      className="not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Vault resolution chain: driver, process.env, .env.local, then dev-fallback. First hit wins; layers past the hit are skipped. If every layer misses, boot fails with VaultBootError listing every gap."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Resolution chain — first hit wins</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          miss every layer → VaultBootError
        </code>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fd-border px-4 py-2 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
          contract
        </span>
        <code className="font-mono text-[11px] text-fd-foreground">{contract}</code>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {LAYERS.map((layer, i) => {
          const probing = beat < 4 && i === beat && (hitAt === -1 || beat <= hitAt);
          const won = i === hitAt && beat > hitAt;
          const missed = (hitAt === -1 || i < hitAt) && beat > i && !won;
          const skipped = hitAt !== -1 && i > hitAt && beat > hitAt;
          return (
            <RevealItem
              as="li"
              key={layer.source}
              className={cn(
                "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
                won
                  ? hit.lit
                  : probing
                    ? "bg-fd-secondary/40"
                    : missed
                      ? "bg-fd-card"
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
                ) : won ? (
                  <span aria-hidden className={cn("size-1.5 rounded-full", hit.hairline)} />
                ) : missed ? (
                  <span aria-hidden className="size-1.5 rounded-full bg-fd-muted-foreground/35" />
                ) : skipped ? (
                  <span aria-hidden className="size-1.5 rounded-full bg-fd-muted-foreground/25" />
                ) : (
                  <span aria-hidden className="size-1.5 rounded-full border border-fd-border" />
                )}
              </span>
              <code className="min-w-0 font-mono text-[11px] break-all text-fd-foreground">
                {layer.source}
              </code>
              <span className="min-w-0 text-[11px] text-fd-muted-foreground">{layer.content}</span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto font-mono text-[10px] transition-opacity duration-300",
                  won
                    ? hit.mark
                    : missed
                      ? "text-fd-muted-foreground/60"
                      : skipped
                        ? "text-fd-muted-foreground/40"
                        : "opacity-0",
                )}
              >
                {won ? "✓ resolved" : missed ? "miss" : skipped ? "skipped" : "·"}
              </span>
            </RevealItem>
          );
        })}
        <RevealItem
          as="li"
          className={cn(
            "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
            resolved ? hit.lit : failed ? fail.lit : "bg-fd-secondary/50",
          )}
        >
          <span className="w-5 shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">→</span>
          <p className="min-w-0 text-xs font-medium text-fd-foreground">{footerLabel}</p>
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[10px] transition-opacity duration-300",
              resolved ? hit.mark : failed ? fail.mark : "opacity-0",
            )}
          >
            {resolved ? valueHint : failed ? "VaultBootError" : "·"}
          </span>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
