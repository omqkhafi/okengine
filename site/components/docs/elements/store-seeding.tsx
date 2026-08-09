/**
 * Store seeding demo — env → seed blocks + upsert idempotency.
 *
 * Claim: essential always runs; ConfigEnv `dev` lights seed `dev`; `prod`
 * lights seed `prod`; `test` lights essential only. Upsert inserts once, then
 * already-existed unless onExisting:"update".
 *
 * Source: resolveSeedCategory + SqlStoreHandle.upsert.
 */

"use client";

import { Database, Sprout } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.teal;
const TICK_MS = 1100;

const ENVS = ["dev", "test", "prod"] as const;
type SeedEnv = (typeof ENVS)[number];

/** Mirrors `resolveSeedCategory` in store/seed.ts. */
function categoryFor(env: SeedEnv): "dev" | "prod" | null {
  if (env === "dev") return "dev";
  if (env === "prod") return "prod";
  return null;
}

const BLOCKS = ["essential", "dev", "prod"] as const;

const UPSERT_PHASES = [
  { status: "upserted", label: "first run — insert" },
  { status: "already-existed", label: "repeat — no-op" },
  { status: "changed", label: 'onExisting: "update"' },
] as const;

/**
 * Ambient demo: which seed blocks fire per ConfigEnv, plus upsert outcomes.
 */
export function StoreSeeding() {
  const tick = useTick(TICK_MS);
  // Reduced motion: settled local + already-existed (idempotent re-run).
  const envIndex = tick === null ? 0 : tick % ENVS.length;
  const env = ENVS[envIndex]!;
  const category = categoryFor(env);
  const upsertPhase = tick === null ? 1 : Math.floor(tick / ENVS.length) % UPSERT_PHASES.length;
  const upsert = UPSERT_PHASES[upsertPhase]!;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="oke db seed: essential always runs; dev lights the dev block; prod lights prod; test runs essential only. Upsert inserts once, then already-existed unless onExisting update."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Seed blocks by env</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          oke db seed — never at boot
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-4 py-2 sm:px-5">
        {ENVS.map((e, i) => {
          const live = i === envIndex;
          return (
            <div key={e} className="flex items-center gap-1.5">
              <code
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
                  live ? tone.active : "border-fd-border text-fd-muted-foreground",
                )}
              >
                {e}
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
        })}
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[32rem]:grid-cols-3"
      >
        {BLOCKS.map((block) => {
          const lit = block === "essential" ? true : category !== null && block === category;
          const skipped = !lit;
          return (
            <RevealItem
              as="li"
              lift
              key={block}
              className={cn(
                "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
                lit ? tone.lit : "bg-fd-card",
              )}
            >
              <code className="inline-flex w-fit items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                <Sprout
                  className={cn("size-3", lit ? tone.icon : "text-fd-muted-foreground")}
                  aria-hidden
                  strokeWidth={1.75}
                />
                {block}
              </code>
              <p className="text-xs font-medium text-fd-foreground">{lit ? "runs" : "skipped"}</p>
              <p className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground">
                {block === "essential"
                  ? "Every env, always."
                  : block === "dev"
                    ? "ConfigEnv dev (Compose laptop)."
                    : "prod only — real deploy targets."}
              </p>
              <code
                className={cn(
                  "mt-auto font-mono text-[10px] transition-colors duration-300",
                  skipped ? "text-fd-muted-foreground/50 line-through" : "text-fd-foreground",
                )}
              >
                {block === "essential"
                  ? "welcome note"
                  : block === "dev"
                    ? "sample rows"
                    : "webhook register"}
              </code>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <div className="border-t border-fd-border px-4 py-3 sm:px-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-fd-foreground">
            upsert — existence, not correction
          </p>
          <code className="font-mono text-[10px] text-fd-muted-foreground">
            matchOn → {upsert.status}
          </code>
        </div>
        <RevealGroup
          as="div"
          className="flex flex-col gap-2 @min-[28rem]:flex-row @min-[28rem]:items-center"
        >
          <RevealItem
            as="div"
            className="inline-flex items-center gap-1.5 rounded border border-fd-border bg-fd-secondary/40 px-2 py-1 font-mono text-[10px] text-fd-foreground"
          >
            <Database className={cn("size-3", tone.icon)} aria-hidden strokeWidth={1.75} />
            notes id=&quot;welcome&quot;
          </RevealItem>
          <RevealItem as="div" className="flex flex-wrap gap-1.5">
            {UPSERT_PHASES.map((p, i) => (
              <code
                key={p.status}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-300",
                  i === upsertPhase ? tone.active : "border-fd-border text-fd-muted-foreground",
                )}
              >
                {p.status}
              </code>
            ))}
          </RevealItem>
          <RevealItem
            as="div"
            className="text-[11px] leading-relaxed text-pretty text-fd-muted-foreground @min-[28rem]:ml-auto"
          >
            {upsert.label}
          </RevealItem>
        </RevealGroup>
      </div>
    </figure>
  );
}
