/**
 * Vault resolution chain — a probe descends the layers until first hit.
 *
 * Layer ids match `VaultResolutionSource`: driver → process.env →
 * .env.local → dev-fallback. Each run probes one layer per beat;
 * the hit layer cycles 1 → 2 → 3 → 4 across runs, and every fifth run
 * misses all four so the fail row lights. Layers past the hit read `skipped`
 * — that is the whole semantics of "first hit wins". Deterministic from one
 * tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

/** Spec order from vault runtime — source ids are the Console labels. */
const LAYERS: ReadonlyArray<{
  readonly n: string;
  readonly source: string;
  readonly content: string;
}> = [
  { n: "1", source: "driver", content: "Built-in vault / managed bag" },
  { n: "2", source: "process.env", content: "Real env (CI, hosting)" },
  { n: "3", source: ".env.local", content: "Local overrides (gitignored)" },
  { n: "4", source: "dev-fallback", content: "dev: on the contract — never in prod" },
];

const TICK_MS = 800;
const BEATS_PER_RUN = 5;

const tone = CHIP_TONE.yellow;
const hit = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

/**
 * Layered resolution with a fail-loud bottom — VaultBootError, not a halfway boot.
 */
export function VaultResolution() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes a hit on `.env.local`. */
  const t = tick ?? 2 * BEATS_PER_RUN + 3;
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  /* Hit layer 0–3 across runs 0–3; run 4 misses everything. */
  const hitAt = run % 5 === 4 ? -1 : run % 4;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Vault resolution chain: driver, process.env, .env.local, then dev-fallback. First hit wins; if every layer misses, boot fails with VaultBootError."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Resolution chain — first hit wins</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          miss every layer → VaultBootError
        </code>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {LAYERS.map((layer, i) => {
          const probing = beat < 4 && i === beat && (hitAt === -1 || beat <= hitAt);
          const resolved = i === hitAt && beat >= hitAt;
          const missed = (hitAt === -1 || i < hitAt) && i < beat && !resolved;
          const skipped = hitAt !== -1 && i > hitAt && beat > hitAt;
          return (
            <RevealItem
              as="li"
              key={layer.n}
              className={cn(
                "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
                resolved ? hit.lit : probing ? tone.lit : "bg-fd-card",
              )}
            >
              <span className="relative flex w-5 shrink-0 items-center gap-1.5">
                <span className="font-mono text-[10px] text-fd-muted-foreground/70">{layer.n}</span>
                {probing && tick !== null ? (
                  <span className="relative flex size-1.5" aria-hidden>
                    <BeatPing key={t} className={tone.wash} />
                    <span className={cn("size-1.5 rounded-full", tone.hairline)} />
                  </span>
                ) : null}
              </span>
              <code className="min-w-0 font-mono text-[11px] break-all text-fd-foreground">
                {layer.source}
              </code>
              <span className="text-[11px] text-fd-muted-foreground">{layer.content}</span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto font-mono text-[10px] transition-opacity duration-300",
                  resolved
                    ? hit.mark
                    : missed
                      ? "text-fd-muted-foreground/60"
                      : skipped
                        ? "text-fd-muted-foreground/40"
                        : "opacity-0",
                )}
              >
                {resolved ? "✓ resolved" : missed ? "miss" : skipped ? "skipped" : "·"}
              </span>
            </RevealItem>
          );
        })}
        <RevealItem
          as="li"
          className={cn(
            "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors duration-300 sm:px-5",
            hitAt === -1 && beat === 4 ? fail.lit : "bg-fd-secondary/50",
          )}
        >
          <span className="w-5 shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">!</span>
          <p className="min-w-0 text-xs font-medium text-fd-foreground">
            All miss → boot fails loud, every gap listed at once
          </p>
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[10px] transition-opacity duration-300",
              hitAt === -1 && beat === 4 ? fail.mark : "opacity-0",
            )}
          >
            VaultBootError
          </span>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
