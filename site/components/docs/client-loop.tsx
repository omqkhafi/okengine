/**
 * Adopt → typed client → test loop visual for Basic Usage.
 *
 * A token descends the three stages on a loop; the "same Manifest" divider
 * pulses as the token crosses it — the handoff is the point. Compact
 * left-aligned stages; deterministic from one tick, never Math.random.
 */

"use client";

import { ArrowDown } from "lucide-react";
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
    title: "Export a Flow",
    meta: "on(http.get…)",
    body: "Contracts and do live in your module. Save — Manifest refreshes.",
  },
  {
    index: "02",
    title: "Adopt the module",
    meta: "oke().adopt({ main })",
    body: "Namespace becomes the typed-client path: api.main.health.",
  },
  {
    index: "03",
    title: "Call or test",
    meta: "createClient · createTestApp",
    body: "Same App type. data and error inferred from contracts — no codegen project.",
  },
];

const TICK_MS = 1100;
const tone = CHIP_TONE.sky;

/**
 * Three-stage loop from Flow export to typed client / test harness.
 */
export function ClientLoop() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % STAGES.length;

  return (
    <figure
      className="not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Closed loop: export a Flow, adopt the module on the app, then call it with createClient or createTestApp using the same App type."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">From Flow to client</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          one App type
        </code>
      </div>

      <RevealGroup as="ol" className="flex flex-col">
        {STAGES.map((stage, i) => {
          const live = i === active;
          return (
            <RevealItem as="li" key={stage.index} className="min-w-0">
              {i > 0 ? (
                <div
                  className={cn(
                    "flex items-center justify-center gap-2 border-b px-4 py-1.5 transition-colors duration-300 sm:px-5",
                    live ? cn("border-fd-border", tone.lit) : "border-fd-border",
                  )}
                >
                  <ArrowDown
                    className={cn(
                      "size-3 shrink-0 transition-colors duration-300",
                      live ? tone.icon : "text-fd-muted-foreground/70",
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "font-mono text-[10px] tracking-[0.16em] uppercase transition-colors duration-300",
                      live ? tone.mark : "text-fd-muted-foreground",
                    )}
                  >
                    same Manifest
                  </span>
                </div>
              ) : null}
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-2 px-4 py-4 transition-colors duration-300 sm:px-5",
                  live ? tone.lit : i < active ? "bg-fd-secondary/30" : undefined,
                )}
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="shrink-0 font-mono text-[10px] text-fd-muted-foreground/70">
                    {stage.index}
                  </span>
                  <p className="text-sm font-medium text-fd-foreground">{stage.title}</p>
                  <code className="rounded border border-fd-border bg-fd-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground">
                    {stage.meta}
                  </code>
                  <span className="relative ml-auto flex size-1.5 shrink-0 self-center" aria-hidden>
                    {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
                    <span
                      className={cn(
                        "size-1.5 rounded-full transition-colors duration-300",
                        live
                          ? tone.hairline
                          : i < active
                            ? "bg-fd-muted-foreground/40"
                            : "bg-fd-border",
                      )}
                    />
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground sm:pl-7">
                  {stage.body}
                </p>
              </div>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
