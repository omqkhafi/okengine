/**
 * Hero title + CTA layout adapted from better-auth/better-auth
 * `docs/components/landing/hero-title.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Copy and links are okengine-original.
 */

"use client";

import { AnimatePresence, motion, MotionConfig, type Variants } from "framer-motion";
import { ArrowRight, Package, Server } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { TypescriptMark } from "@/components/chrome/icons";
import { AiOnboardButton } from "@/components/landing/ai-onboard-button";
import { cn } from "@/lib/cn";
import { ELEMENTS, REAL_TODAY, TAGLINE } from "@/lib/elements";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/**
 * One shared shell with the law chip above — icons carry identity.
 * TypeScript keeps the brand mark in `#3178C6`; the others stay mono.
 */
const HERO_PILL_ICON: Record<(typeof REAL_TODAY)[number]["id"], ReactNode> = {
  backend: <Server aria-hidden className="size-3 text-fd-foreground/70" strokeWidth={1.75} />,
  typescript: <TypescriptMark className="size-3 text-[#3178C6] dark:text-[#79b8ff]" />,
  version: <Package aria-hidden className="size-3 text-fd-foreground/70" strokeWidth={1.75} />,
};

/** Beat ids — each number in the headline is a real count from the framework. */
type BeatId = "law" | "elements" | "contract";

/** One species, four names — from introduction / unified-theory §4. */
const TRIGGERS: ReadonlyArray<{ readonly code: string; readonly zoo: string }> = [
  { code: 'http.post("/notes")', zoo: "an API endpoint" },
  { code: 'clock("cleanup", { every: "10m" })', zoo: "a cron job" },
  { code: "orderPlaced", zoo: "a queue consumer" },
  { code: 'db.table(users).changed("email")', zoo: "a CDC trigger" },
];

const BEATS: ReadonlyArray<{
  readonly id: BeatId;
  readonly label: string;
}> = [
  { id: "law", label: "One law." },
  { id: "elements", label: "Eight elements." },
  { id: "contract", label: "One contract." },
];

/** Same spring as the sticky topbar so hero motion feels like one system. */
const EASE = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

const column: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

const settle: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: EASE,
  },
};

/** Opacity-only settle when the visitor prefers reduced motion. */
const settleStatic: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0 } },
};

const beatLine: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: EASE,
  },
};

const beatLineStatic: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0 } },
};

const beatsGroup: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.14,
    },
  },
};

const pills: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const pill: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: EASE,
  },
};

const pillStatic: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0 } },
};

/**
 * Left-column homepage hero: interactive two-count headline, tagline, CTAs.
 *
 * Each headline line is a real count from the framework. Selecting one swaps the
 * tagline for a compact panel that proves the number — law or elements.
 */
export function HeroTitle() {
  const baseId = useId();
  const [active, setActive] = useState<BeatId | null>(null);
  const reduced = useClientReducedMotion();
  const settleVariants = reduced ? settleStatic : settle;
  const beatVariants = reduced ? beatLineStatic : beatLine;
  const pillVariants = reduced ? pillStatic : pill;

  useEffect(() => {
    if (active === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    <MotionConfig reducedMotion="never">
      <motion.div
        className="relative z-[2] -mx-5 flex h-full w-[calc(100%+2.5rem)] flex-col justify-center px-5 py-14 sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8 sm:py-16"
        variants={column}
        initial={reduced ? false : "hidden"}
        animate="show"
        onPointerDown={(event) => {
          if (active === null) return;
          if (!(event.target instanceof Element)) return;
          // Keep the selection when the press lands on a beat, panel, or CTA.
          if (event.target.closest("[data-hero-interactive]")) return;
          setActive(null);
        }}
      >
        <motion.div variants={settleVariants} data-hero-interactive>
          <Link
            href="/docs/understand/the-model"
            className="group inline-flex w-fit items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-[11px] text-fd-muted-foreground transition-colors hover:bg-fd-secondary/60"
          >
            <span className="font-mono text-fd-foreground">on(Trigger) → Effects</span>
            <span className="text-fd-muted-foreground/70">the one law</span>
            <ArrowRight
              className="size-3 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </motion.div>

        <motion.h1
          className="pt-5 text-3xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-4xl xl:text-5xl"
          variants={beatsGroup}
          data-hero-interactive
        >
          <span className="sr-only">
            A new programming model for backends. One law. Eight elements. One contract.
          </span>
          <span className="block font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase pb-2">
            A new programming model for backends
          </span>
          <span
            role="tablist"
            aria-label="Explore the three pillars"
            className="flex flex-col items-start"
          >
            {BEATS.map((beat) => {
              const selected = active === beat.id;
              return (
                <motion.span key={beat.id} className="block" variants={beatVariants}>
                  <button
                    type="button"
                    role="tab"
                    id={`${baseId}-${beat.id}`}
                    aria-selected={selected}
                    aria-controls={`${baseId}-panel`}
                    aria-expanded={selected}
                    onClick={() => setActive((prev) => (prev === beat.id ? null : beat.id))}
                    className={cn(
                      "group relative text-left transition-colors duration-200",
                      selected
                        ? "text-fd-foreground"
                        : active === null
                          ? "text-fd-foreground hover:text-fd-foreground/80"
                          : "text-fd-muted-foreground/45 hover:text-fd-muted-foreground",
                    )}
                  >
                    <span className="relative">
                      {beat.label}
                      <motion.span
                        aria-hidden
                        className={cn(
                          "absolute inset-x-0 -bottom-0.5 h-px origin-left bg-fd-foreground/50",
                          reduced && (selected ? "scale-x-100" : "scale-x-0"),
                        )}
                        initial={false}
                        animate={reduced ? undefined : { scaleX: selected ? 1 : 0 }}
                        transition={{ duration: 0.28, ease: "easeOut" }}
                      />
                    </span>
                  </button>
                </motion.span>
              );
            })}
          </span>
        </motion.h1>

        <motion.div className="mt-5 min-h-[7.5rem] max-w-md" variants={settleVariants}>
          <AnimatePresence mode="wait" initial={false}>
            {active === null ? (
              <motion.div
                key="tagline"
                role="tabpanel"
                id={`${baseId}-panel`}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
              >
                <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
                  {TAGLINE}
                </p>
                <p className="mt-2 font-mono text-[11px] text-fd-muted-foreground/60">
                  Select a line — each number is exact.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={active}
                role="tabpanel"
                id={`${baseId}-panel`}
                aria-labelledby={`${baseId}-${active}`}
                data-hero-interactive
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
              >
                <BeatPanel id={active} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div
          className="flex flex-wrap items-center gap-2 pt-7 sm:gap-3"
          variants={settleVariants}
          data-hero-interactive
        >
          <Link
            href="/docs/understand/see-it-work"
            className="inline-flex items-center gap-1.5 bg-fd-primary px-5 py-2.5 text-xs font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 sm:text-sm"
          >
            Get started
          </Link>
          <AiOnboardButton />
        </motion.div>

        <motion.ul className="mt-8 flex flex-wrap gap-2" variants={pills}>
          {REAL_TODAY.map((item) => (
            <motion.li
              key={item.id}
              variants={pillVariants}
              className="inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-card px-2.5 py-1 font-mono text-[11px] text-fd-muted-foreground"
            >
              {HERO_PILL_ICON[item.id]}
              {item.label}
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </MotionConfig>
  );
}

/**
 * Compact proof panel for one headline beat — law or elements.
 *
 * @param id - Which count is open
 */
function BeatPanel({ id }: { readonly id: BeatId }) {
  if (id === "law") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground">
          Every backend behavior is the same species — a{" "}
          <span className="text-fd-foreground">flow</span> bound with{" "}
          <code className="font-mono text-fd-foreground">on()</code>. Only the trigger changes.
        </p>
        <ul className="flex flex-col gap-1.5 font-mono text-[11px] sm:text-xs">
          {TRIGGERS.map((row) => (
            <li key={row.code} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="text-fd-foreground">{row.code}</code>
              <span className="text-fd-muted-foreground/60">→ {row.zoo}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (id === "contract") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground">
          The <span className="text-fd-foreground">Manifest</span> is the compiled, versioned
          contract between the backend model and everything derived from it.
        </p>
        <p className="font-mono text-[11px] text-fd-muted-foreground/70 sm:text-xs">
          Client · Console · MCP · OpenAPI · Traces · Docker — one diffable contract.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground">
        Everything a backend needs reduces to eight typed elements. New infra is a{" "}
        <span className="text-fd-foreground">driver</span> — never a ninth.
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
        {ELEMENTS.map((el) => (
          <li key={el.name}>
            <Link
              href={el.href}
              className="group flex flex-col gap-0.5 rounded-sm py-0.5 transition-colors"
            >
              <span className="font-mono text-xs text-fd-foreground group-hover:underline">
                {el.name}
              </span>
              <span className="text-[10px] leading-snug text-fd-muted-foreground">
                {el.essence}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
