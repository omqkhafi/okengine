/**
 * Drift board — the tax every hand-maintained seam pays.
 *
 * One change propagates two ways. Left: five hand-maintained copies of the
 * code's knowledge fall behind at fixed lags and stay behind — that is drift.
 * Right: five surfaces derived from one Manifest flip to the new version in
 * the same beat — they cannot disagree, because none of them is a copy.
 * Deterministic from one tick, never Math.random; reduced motion freezes the
 * drifted snapshot, which already tells the story.
 */

"use client";

import { motion } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const hand = CHIP_TONE.amber;
const derived = CHIP_TONE.sky;

/** Hand-maintained copies, each stuck at its own lag behind the code. */
const HAND_COPIES: ReadonlyArray<{ readonly label: string; readonly lag: number }> = [
  { label: "cache keys", lag: 1 },
  { label: "OpenAPI spec", lag: 2 },
  { label: "dashboard queries", lag: 3 },
  { label: "permission checks", lag: 1 },
  { label: "env checklist", lag: 2 },
];

/** Manifest derivations — always current, by construction. */
const DERIVATIONS = [
  "cache keys",
  "typed client",
  "Console panels",
  "capability matrix",
  "MCP tools",
] as const;

const TICK_MS = 1300;
const BEATS_PER_VERSION = 3;

const CHIP = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * One schema bump, two propagation stories: maintained by hand vs derived.
 */
export function DriftBoard() {
  const tick = useTick(TICK_MS);
  const t = tick ?? 0;
  /* The code advances through v3 → v4 → v5; copies with a lag trail it. */
  const version = 3 + (Math.floor(t / BEATS_PER_VERSION) % 3);
  const bump = tick !== null && t % BEATS_PER_VERSION === 0;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Drift versus derivation: hand-maintained copies like cache keys, an OpenAPI spec, and dashboard queries fall behind the code at different lags, while the typed client, Console, capability matrix, and MCP tools derive from one Manifest and stay current."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">
          One change, two propagation stories
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          schema v3 → v4 → v5
        </code>
      </div>

      <div className="grid grid-cols-1 gap-px bg-fd-border @min-[36rem]:grid-cols-2">
        <RevealGroup as="div" className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
          <RevealItem as="div">
            <p className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
              Maintained by hand
            </p>
          </RevealItem>
          <RevealItem
            as="div"
            className="flex items-center justify-between rounded-md border border-fd-border bg-fd-secondary/40 px-3 py-2"
          >
            <span className="text-xs font-medium text-fd-foreground">your code</span>
            <VersionChip version={version} live={bump} />
          </RevealItem>
          <RevealItem as="div" className="flex justify-center" aria-hidden>
            <ArrowDown className="size-3 text-fd-muted-foreground/70" />
          </RevealItem>
          <RevealItem as="ul" className="flex min-w-0 flex-col gap-1.5">
            {HAND_COPIES.map((copy) => {
              const copyVersion = Math.max(1, version - copy.lag);
              const behind = version - copyVersion;
              return (
                <li
                  key={copy.label}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 transition-colors duration-300",
                    behind > 0 ? hand.idle : "border-fd-border",
                  )}
                >
                  <span className="min-w-0 text-xs text-fd-foreground">{copy.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {behind > 0 ? (
                      <span aria-hidden className={cn(CHIP, hand.active)}>
                        −{behind}
                      </span>
                    ) : null}
                    <code className="font-mono text-[10px] text-fd-muted-foreground">
                      v{copyVersion}
                    </code>
                  </span>
                </li>
              );
            })}
          </RevealItem>
          <RevealItem as="div">
            <p className="text-[11px] text-pretty text-fd-muted-foreground">
              Each copy trails at its own depth — and never catches up on its own.
            </p>
          </RevealItem>
        </RevealGroup>

        <RevealGroup as="div" className="flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5">
          <RevealItem as="div">
            <p className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
              Derived from the Manifest
            </p>
          </RevealItem>
          <RevealItem
            as="div"
            className={cn(
              "relative flex items-center justify-between rounded-md border px-3 py-2 transition-colors duration-300",
              bump ? derived.active : "border-fd-border bg-fd-secondary/40",
            )}
          >
            <span className="text-xs font-medium text-fd-foreground">the Manifest</span>
            <span className="flex items-center gap-2">
              {bump ? (
                <span className="relative flex size-1.5" aria-hidden>
                  <BeatPing key={t} className={derived.wash} />
                  <span className={cn("size-1.5 rounded-full", derived.hairline)} />
                </span>
              ) : null}
              <VersionChip version={version} live={bump} />
            </span>
          </RevealItem>
          <RevealItem as="div" className="flex justify-center" aria-hidden>
            <ArrowDown className="size-3 text-fd-muted-foreground/70" />
          </RevealItem>
          <RevealItem as="ul" className="flex min-w-0 flex-col gap-1.5">
            {DERIVATIONS.map((surface) => (
              <li
                key={surface}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 transition-colors duration-300",
                  bump ? derived.lit : "border-fd-border",
                )}
              >
                <span className="min-w-0 text-xs text-fd-foreground">{surface}</span>
                <VersionChip version={version} live={bump} quiet />
              </li>
            ))}
          </RevealItem>
          <RevealItem as="div">
            <p className="text-[11px] text-pretty text-fd-muted-foreground">
              Five surfaces, one source — they flip together on every save.
            </p>
          </RevealItem>
        </RevealGroup>
      </div>
    </figure>
  );
}

/**
 * Version chip that pops when its version advances.
 *
 * @param version - Current version number
 * @param live - Whether this beat is a bump
 * @param quiet - Render without border (list rows)
 */
function VersionChip({
  version,
  live,
  quiet = false,
}: {
  readonly version: number;
  readonly live: boolean;
  readonly quiet?: boolean;
}) {
  return (
    <motion.code
      key={version}
      initial={live ? { y: 5, opacity: 0 } : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "font-mono text-[10px]",
        quiet ? "text-fd-muted-foreground" : cn(CHIP, "border-fd-border text-fd-foreground"),
      )}
    >
      v{version}
    </motion.code>
  );
}
