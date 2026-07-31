/**
 * Channel human physics — a send travels consent → locale → fallback → receipt.
 *
 * The spotlight hops one card per beat, the order `fx.send` actually applies
 * them. When fallback is live, its sms → wa attempts appear: first medium
 * failed, second delivered. Deterministic from one tick, never Math.random.
 */

"use client";

import { motion } from "framer-motion";
import { Languages, ListOrdered, Receipt, ShieldCheck, type LucideIcon } from "lucide-react";
import { BeatPing, RevealGroup, RevealItem, useTick } from "@/components/docs/reveal";
import { CHIP_TONE } from "@/lib/element-tones";
import { cn } from "@/lib/cn";

const tone = CHIP_TONE.cyan;

const PHYSICS: ReadonlyArray<{
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail: string;
}> = [
  {
    id: "consent",
    icon: ShieldCheck,
    title: "Consent",
    detail: "Opt-out suppresses before the provider is touched",
  },
  {
    id: "locale",
    icon: Languages,
    title: "Locale",
    detail: "Renders per recipient, falls back through the chain",
  },
  {
    id: "fallback",
    icon: ListOrdered,
    title: "Fallback",
    detail: "via: [sms, wa] — first success wins, all attempts recorded",
  },
  {
    id: "receipts",
    icon: Receipt,
    title: "Receipts",
    detail: "Every attempt: driver, ok/error, timestamp, message id",
  },
];

const TICK_MS = 1100;

const ATTEMPT = "rounded border px-1.5 py-0.5 font-mono text-[10px]";

/**
 * One send, four human physics around it — not optional middleware.
 */
export function ChannelPhysics() {
  const tick = useTick(TICK_MS);
  const active = tick === null ? -1 : tick % PHYSICS.length;

  return (
    <figure
      className="@container not-prose my-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Channel physics: consent is checked before sending, locale resolves through a chain, fallback tries mediums in order, and receipts record every attempt."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="text-sm font-medium text-fd-foreground">Around one fx.send</p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">
          {"fx.send(template, { to, data })"}
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[32rem]:grid-cols-2 @min-[56rem]:grid-cols-4"
      >
        {PHYSICS.map((p, i) => {
          const Icon = p.icon;
          const live = i === active;
          return (
            <RevealItem
              as="li"
              lift
              key={p.id}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors duration-300 sm:px-5",
                live ? tone.lit : "bg-fd-card hover:bg-fd-secondary/40",
              )}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-fd-foreground">
                <span className="relative flex size-3.5 shrink-0" aria-hidden>
                  {live && tick !== null ? <BeatPing key={tick} className={tone.wash} /> : null}
                  <Icon
                    className={cn(
                      "size-3.5 transition-colors duration-300",
                      live ? tone.icon : "text-fd-muted-foreground",
                    )}
                    aria-hidden
                    strokeWidth={1.75}
                  />
                </span>
                {p.title}
              </p>
              <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                {p.detail}
              </p>
              {p.id === "fallback" ? (
                <p className="flex min-h-5 items-center gap-1" aria-hidden>
                  {live ? (
                    <>
                      <motion.code
                        key={`sms-${tick}`}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className={cn(ATTEMPT, CHIP_TONE.rose.idle)}
                      >
                        sms ✗
                      </motion.code>
                      <motion.code
                        key={`wa-${tick}`}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: 0.35 }}
                        className={cn(ATTEMPT, CHIP_TONE.emerald.idle)}
                      >
                        wa ✓
                      </motion.code>
                    </>
                  ) : null}
                </p>
              ) : null}
            </RevealItem>
          );
        })}
      </RevealGroup>
    </figure>
  );
}
