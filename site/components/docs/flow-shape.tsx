/**
 * Flow shape visual — one species, one pipeline.
 *
 * A token travels Trigger → Contracts → do + fx → Effects on a loop, the
 * order a run actually takes. Stacks on phones; 2×2 in the docs article.
 * Deterministic from one tick, never Math.random.
 */

"use client";

import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const STAGES: ReadonlyArray<{
  readonly index: string;
  readonly title: string;
  readonly meta: string;
  readonly body: string;
}> = [
  {
    index: "01",
    title: "Trigger",
    meta: "http · every · signal · cdc",
    body: "How work starts. Only this piece changes between an endpoint, a job, a consumer, and a row hook.",
  },
  {
    index: "02",
    title: "Contracts",
    meta: "in · out · errors",
    body: "Validated before and after do. Failures are typed values — returned, never thrown as mystery status text.",
  },
  {
    index: "03",
    title: "do + fx",
    meta: "single door",
    body: "The body. Every read, write, emit, secret, and model call goes through fx — side-channel I/O is a defect.",
  },
  {
    index: "04",
    title: "Effects",
    meta: "inferred",
    body: "Recorded from fx touches. Cache keys, capability tokens, live queries, and Manifest Diff fall out — no hand annotations.",
  },
];

const TICK_MS = 1000;
const tone = CHIP_TONE.sky;

/**
 * Pipeline diagram of `on(Trigger) → Effects`.
 */
export function FlowShape() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % STAGES.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Flow shape: a trigger starts work, contracts validate input and output, the do body touches the world only through fx, and effects are inferred from those touches."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="min-w-0 font-mono text-sm font-medium text-fd-foreground">
          on(Trigger) → Effects
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">one species</code>
      </div>

      <RevealGroup
        as="ol"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[28rem]:grid-cols-2"
      >
        {STAGES.map((stage, i) => {
          const live = i === active;
          const passed = i < active;
          return (
            <RevealItem
              as="li"
              key={stage.index}
              className={cn(
                "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
                live ? tone.lit : passed ? "bg-fd-secondary/30" : "bg-fd-card",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-fd-muted-foreground/70">
                  {stage.index}
                </span>
                <p className="text-sm font-medium text-fd-foreground">{stage.title}</p>
                <span className="relative ml-auto flex size-1.5 shrink-0 self-center" aria-hidden>
                  {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-300",
                      live ? tone.hairline : passed ? "bg-fd-muted-foreground/40" : "bg-fd-border",
                    )}
                  />
                </span>
              </div>
              <code className="w-fit max-w-full rounded border border-fd-border bg-fd-secondary/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-fd-muted-foreground uppercase">
                {stage.meta}
              </code>
              <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                {stage.body}
              </p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
