/**
 * Four architectural proof stories — demonstrating how the eight closed elements
 * compose to produce Realtime, Security, Agents, and Operations without new subsystems.
 */

"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import { Activity, Bot, Gauge, Shield, type LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

type Story = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: LucideIcon;
  readonly steps: ReadonlyArray<string>;
  readonly takeaway: string;
};

const STORIES: ReadonlyArray<Story> = [
  {
    id: "realtime",
    title: "Realtime",
    subtitle: "Store + Signal + Gate RLS",
    icon: Activity,
    steps: ["Global CDC", "RLS re-check", "Signal SSE", "useLiveQuery"],
    takeaway: "No new physics — composed from Store, Signal, and per-subscriber RLS stamping.",
  },
  {
    id: "security",
    title: "Security & Tenancy",
    subtitle: "Gate + Store RLS + Tenancy",
    icon: Shield,
    steps: ["API Keys / OAuth", "Gate Scope", "Tenant RLS", "Blast-Radius Diff"],
    takeaway: "Same security model across users, operators, and agents — diffable on save.",
  },
  {
    id: "agents",
    title: "Agents & MCP",
    subtitle: "Flow + Gate + OAuth 2.1 AS",
    icon: Bot,
    steps: ["Flow behavior", "mcp.tool()", "OAuth 2.1 AS", "Agent Tool Run"],
    takeaway: "MCP is a surface of the model. Agents only invoke declared Flows through Gate.",
  },
  {
    id: "operations",
    title: "Observability",
    subtitle: "Manifest + fx Ledger + Console",
    icon: Gauge,
    steps: ["Manifest Contract", "Effect Ledger", "Live Flow Graph", "oke doctor"],
    takeaway: "Your backend is not just executable; it is structurally inspectable.",
  },
];

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 32, mass: 0.75 },
  },
};

function trackSpotlight(event: MouseEvent<HTMLLIElement>): void {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
  card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
}

/**
 * Grid of the 4 architectural proof stories showing composition over feature bloat.
 */
export function ArchitecturalProof(): ReactNode {
  const reduced = useClientReducedMotion();

  return (
    <div className="@container not-prose w-full max-w-full min-w-0">
      <MotionConfig reducedMotion="never">
        <motion.ul
          className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border @min-[36rem]:grid-cols-2 @min-[64rem]:grid-cols-4"
          variants={list}
          initial={reduced ? false : "hidden"}
          whileInView={reduced ? undefined : "show"}
          viewport={{ once: true, margin: "-8% 0px" }}
        >
          {STORIES.map((story) => {
            const Icon = story.icon;
            return (
              <motion.li
                key={story.id}
                variants={item}
                onMouseMove={trackSpotlight}
                className="sently-spotlight flex min-w-0 flex-col justify-between gap-4 bg-fd-card p-5"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md border border-fd-border bg-fd-secondary/50 text-fd-foreground">
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                      proof · {story.id}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-fd-foreground">{story.title}</h3>
                    <p className="font-mono text-[11px] text-fd-muted-foreground/80">
                      {story.subtitle}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1 rounded-lg border border-fd-border/70 bg-fd-background/50 p-2.5">
                    {story.steps.map((step, idx) => (
                      <div
                        key={step}
                        className="flex items-center gap-2 font-mono text-[11px] text-fd-foreground"
                      >
                        <span className="text-[10px] text-fd-muted-foreground/50">0{idx + 1}</span>
                        <span className="truncate">{step}</span>
                        {idx < story.steps.length - 1 ? (
                          <span className="ml-auto text-[10px] text-fd-muted-foreground/40">↓</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-pretty text-fd-muted-foreground">
                  {story.takeaway}
                </p>
              </motion.li>
            );
          })}
        </motion.ul>
      </MotionConfig>
    </div>
  );
}
