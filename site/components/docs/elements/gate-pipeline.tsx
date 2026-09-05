/**
 * Gate chain evaluation — first denial wins.
 *
 * Each run walks `.gate(member, canBook, fair)` left to right. Four scenarios
 * cycle: all pass → `do` runs; deny at `member` (anonymous) → Unauthorized;
 * deny at `canBook` (authed, missing scope) → Forbidden; deny at `fair` →
 * RateLimited. Gates after the denial read `skipped`. Outcome copy stays
 * neutral until the final beat. Deterministic from one tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const GATES: ReadonlyArray<{
  readonly name: string;
  readonly kind: string;
  readonly detail: string;
}> = [
  { name: "member", kind: "policy", detail: "auth.verified" },
  { name: "canBook", kind: "scope", detail: "booking:create" },
  { name: "fair", kind: "rate", detail: 'max:60 · per:"1m" · keyBy:"ip"' },
];

const SCENARIOS: ReadonlyArray<{
  readonly denyAt: number;
  readonly code: "Unauthorized" | "Forbidden" | "RateLimited" | null;
  readonly principal: string;
}> = [
  { denyAt: -1, code: null, principal: "verified + scope" },
  { denyAt: 0, code: "Unauthorized", principal: "anonymous" },
  { denyAt: 1, code: "Forbidden", principal: "authed, missing scope" },
  { denyAt: 2, code: "RateLimited", principal: "quota burned" },
];

const TICK_MS = 850;
const BEATS_PER_RUN = 4;

const pass = CHIP_TONE.emerald;
const probe = CHIP_TONE.emerald;
const fail = CHIP_TONE.rose;

/**
 * Permission sits at the trigger — first denial wins; a denied flow never touches fx.
 */
export function GatePipeline() {
  const tick = useTick(TICK_MS);
  /* Reduced motion freezes a completed pass run (every gate ✓, do runs). */
  const t = tick ?? BEATS_PER_RUN - 1;
  const run = Math.floor(t / BEATS_PER_RUN);
  const beat = t % BEATS_PER_RUN;
  const scenario = SCENARIOS[run % SCENARIOS.length]!;
  const { denyAt, code, principal } = scenario;
  const outcomeLive = beat === BEATS_PER_RUN - 1;
  const footerLabel = !outcomeLive
    ? "Evaluating chain…"
    : code === null
      ? "Every gate passed — do runs"
      : "Denied — typed failure, never thrown mid-do";

  return (
    <figure
      className="not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Gate chain: member, canBook, and fair evaluate left to right. First denial wins — Unauthorized when anonymous, Forbidden when authenticated but a policy says no, RateLimited when the quota is burned. Later gates are skipped. do runs only when every gate passed."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Chain — first denial wins</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          .gate(member, canBook, fair)
        </code>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fd-border px-4 py-2 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
          principal
        </span>
        <code className="font-mono text-[11px] text-fd-foreground">{principal}</code>
      </div>

      <RevealGroup as="ol" className="flex flex-col gap-px bg-fd-border">
        {GATES.map((gate, i) => {
          const probing = beat < 3 && i === beat && (denyAt === -1 || beat <= denyAt);
          const passed = (denyAt === -1 || i < denyAt) && beat > i;
          const denied = i === denyAt && beat > denyAt;
          const skipped = denyAt !== -1 && i > denyAt && beat > denyAt;
          return (
            <RevealItem
              as="li"
              key={gate.name}
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
                {gate.name}
              </code>
              <span className="font-mono text-[10px] text-fd-muted-foreground/70">{gate.kind}</span>
              <span className="min-w-0 text-[11px] text-fd-muted-foreground">{gate.detail}</span>
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
            {code === null ? "do runs" : code}
          </span>
        </RevealItem>
      </RevealGroup>
    </figure>
  );
}
