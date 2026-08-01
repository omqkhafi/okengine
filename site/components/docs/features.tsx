/**
 * Features grid — structural layout adapted from better-auth/better-auth
 * `docs/components/docs/features.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Content and icons are okengine-original.
 */

"use client";

import {
  Activity,
  AlarmClock,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Braces,
  CircleDot,
  Database,
  Fingerprint,
  Flag,
  FolderOpen,
  Gauge,
  Hourglass,
  Inbox,
  KeyRound,
  ListOrdered,
  Mail,
  MessageSquare,
  MessagesSquare,
  Moon,
  Quote,
  Search,
  Server,
  Settings2,
  Share2,
  ShieldBan,
  ShieldCheck,
  Timer,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { MotionConfig, motion, type Transition, type Variants } from "framer-motion";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ELEMENTS, type ElementPreviewKind } from "@/lib/elements";
import { CHIP_TONE, ELEMENT_CHIP, elementTone, type ElementChipTone } from "@/lib/element-tones";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/** Snappy spring — micro-interactions, not ambient loops. */
const CHIP_SPRING: Transition = { type: "spring", stiffness: 520, damping: 28, mass: 0.55 };

/** Card hover drives a staggered cascade through the preview row. */
const PREVIEW_ROW: Variants = {
  idle: {},
  hover: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

const PREVIEW_CHIP: Variants = {
  idle: { y: 0, scale: 1 },
  hover: { y: -3, scale: 1.04 },
};

/**
 * Eight-element feature grid (better-auth Features shell + okengine data).
 *
 * Numbered cells share hairline rules rather than gaps, so the eight elements
 * read as one table — the closed set is the point.
 */
export function Features() {
  return (
    /*
     * Reduced motion is applied in the tree via {@link useClientReducedMotion}.
     * Keep MotionConfig at `never` so Motion does not refuse transform animates
     * (and warn) while we are still gating those props ourselves.
     */
    <MotionConfig reducedMotion="never" transition={CHIP_SPRING}>
      {/* Container queries: docs article is narrower than the homepage band. */}
      <div className="@container not-prose w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
          <span className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
            eight elements
          </span>
          <span className="font-mono text-[11px] text-fd-muted-foreground">
            closed set · irreducible physics
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-px bg-fd-border @min-[28rem]:grid-cols-2 @min-[52rem]:grid-cols-4">
          {ELEMENTS.map((feature, i) => (
            <FeatureCard key={feature.name} feature={feature} index={i} />
          ))}
        </ul>
      </div>
    </MotionConfig>
  );
}

/**
 * One element cell — hover/focus lights the preview chips as a micro-interaction.
 *
 * @param feature - Element descriptor
 * @param index - Zero-based grid index
 */
function FeatureCard({ feature, index }: { feature: (typeof ELEMENTS)[number]; index: number }) {
  const Icon = feature.icon;
  const tone = elementTone(feature.preview);
  const [active, setActive] = useState(false);

  return (
    <li className="bg-fd-card">
      <Link
        href={feature.href}
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className={cn(
          "group flex h-full min-h-44 flex-col px-4 py-4 transition-colors @min-[28rem]:min-h-52 @min-[28rem]:px-5 @min-[28rem]:py-5",
          active ? tone.lit : "bg-transparent",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "font-mono text-[10px] transition-colors",
              active ? tone.mark : "text-fd-muted-foreground/70",
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <motion.span
            aria-hidden
            animate={active ? { scale: 1.12, rotate: -6 } : { scale: 1, rotate: 0 }}
            transition={CHIP_SPRING}
            className={cn("transition-colors", active ? tone.mark : "text-fd-muted-foreground/70")}
          >
            <Icon className="size-3.5" aria-hidden />
          </motion.span>
        </div>

        <p className="mt-3 text-base font-semibold text-fd-foreground">
          {feature.name}
          <span className="ms-2 text-xs font-normal text-fd-muted-foreground">
            {feature.essence}
          </span>
        </p>
        <p className="mt-1 text-sm leading-snug text-fd-muted-foreground">{feature.description}</p>

        <div className="mt-auto pt-5">{previewFor(feature.preview, active)}</div>
      </Link>
    </li>
  );
}

/** One labeled chip in a multi-pill preview. */
type PreviewPillItem = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: ElementChipTone;
};

/**
 * Illustrative UI fragment from real API shapes in the specs.
 *
 * @param kind - Element preview kind
 * @param active - Whether the parent card is hovered or focused
 */
/** Shared chip chrome — one size and radius for every preview. */
const CHIP_SHELL = "rounded-md border px-2 py-1 font-mono text-[10px] leading-none";

/**
 * Illustrative UI fragment from real API shapes in the specs.
 *
 * @param kind - Element preview kind
 * @param active - Whether the parent card is hovered or focused
 */
function previewFor(kind: ElementPreviewKind, active: boolean): ReactNode {
  /** Primary chip always uses the element's canonical ink. */
  const primary = ELEMENT_CHIP[kind];
  switch (kind) {
    case "flow":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "http", icon: ArrowRight, tone: primary },
            { label: "webhook", icon: Webhook, tone: "amber" },
            { label: "consumer", icon: Inbox, tone: "teal" },
            { label: "durable", icon: Workflow, tone: "orange" },
          ]}
        />
      );
    case "signal":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "once", icon: CircleDot, tone: primary },
            { label: "broadcast", icon: Share2, tone: "orange" },
            { label: "live", icon: Activity, tone: "emerald" },
          ]}
        />
      );
    case "store":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "sql", icon: Database, tone: primary },
            { label: "kv", icon: Braces, tone: "amber" },
            { label: "files", icon: FolderOpen, tone: "cyan" },
            { label: "index", icon: Search, tone: "orange" },
          ]}
        />
      );
    case "clock":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "every", icon: Timer, tone: primary },
            { label: "delay", icon: Hourglass, tone: "amber" },
            { label: "sleep", icon: Moon, tone: "teal" },
            { label: "ttl", icon: AlarmClock, tone: "cyan" },
          ]}
        />
      );
    case "gate":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "gate", icon: ShieldCheck, tone: primary },
            { label: "rate", icon: Gauge, tone: "amber" },
            { label: "quota", icon: ListOrdered, tone: "teal" },
            { label: "flag", icon: Flag, tone: "orange" },
          ]}
        />
      );
    case "vault":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "fp", icon: Fingerprint, tone: primary },
            { label: "secret", icon: KeyRound, tone: "amber" },
            { label: "config", icon: Settings2, tone: "teal" },
            { label: "env", icon: Server, tone: "orange" },
          ]}
        />
      );
    case "channel":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "email", icon: Mail, tone: primary },
            { label: "SMS", icon: MessageSquare, tone: "teal" },
            { label: "wa", icon: MessagesSquare, tone: "orange" },
            { label: "push", icon: Bell, tone: "amber" },
          ]}
        />
      );
    case "ai":
      return (
        <PreviewPills
          active={active}
          items={[
            { label: "noPii", icon: ShieldBan, tone: primary },
            { label: "prompt", icon: Quote, tone: "amber" },
            { label: "agent", icon: Bot, tone: "teal" },
            { label: "RAG", icon: BookOpen, tone: "orange" },
          ]}
        />
      );
  }
}

/**
 * Multi-chip preview row — each pill has its own icon and tone; cascade on hover.
 *
 * @param active - Parent card hover/focus
 * @param items - Chip labels with icons and tones
 */
function PreviewPills({
  active,
  items,
}: {
  active: boolean;
  items: ReadonlyArray<PreviewPillItem>;
}) {
  const reduced = useClientReducedMotion();

  return (
    <motion.div
      className="flex flex-wrap gap-1.5"
      variants={PREVIEW_ROW}
      initial="idle"
      animate={reduced ? "idle" : active ? "hover" : "idle"}
    >
      {items.map(({ label, icon: Icon, tone }) => {
        const palette = CHIP_TONE[tone];
        return (
          <motion.span
            key={label}
            variants={PREVIEW_CHIP}
            whileHover={
              reduced
                ? undefined
                : {
                    scale: 1.08,
                    y: -4,
                  }
            }
            whileTap={reduced ? undefined : { scale: 0.96 }}
            transition={CHIP_SPRING}
            className={cn(
              CHIP_SHELL,
              "inline-flex origin-center items-center gap-1.5 transition-colors",
              active ? palette.active : palette.idle,
            )}
          >
            <Icon className={cn("size-3 shrink-0", palette.icon)} aria-hidden strokeWidth={1.75} />
            {label}
          </motion.span>
        );
      })}
    </motion.div>
  );
}
