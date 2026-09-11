/**
 * Hero title + CTA layout adapted from better-auth/better-auth
 * `docs/components/landing/hero-title.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Copy and links are okengine-original.
 */

"use client";

import { motion, MotionConfig, type Variants } from "framer-motion";
import { ArrowRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TAGLINE } from "@/lib/elements";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const BEATS: ReadonlyArray<string> = ["One law.", "Eight elements."];

/** The scaffold command from the package contract — `bunx create-oke@latest <name>`. */
const SCAFFOLD = "bunx create-oke@latest";

const SETTLE: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0 },
};

/**
 * Centered homepage hero copy: law chip, the headline beats, the positioning
 * line, and the two ways in — read the architecture, or scaffold a project.
 * The stage below proves each count by walking the starter create Flow.
 */
export function HeroTitle() {
  const reduced = useClientReducedMotion();
  const [copied, setCopied] = useState(false);

  async function copyScaffold(): Promise<void> {
    try {
      await navigator.clipboard.writeText(SCAFFOLD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <MotionConfig reducedMotion="never">
      <motion.div
        className="relative z-[2] flex w-full max-w-4xl flex-col items-center text-center"
        initial={reduced ? false : "hidden"}
        animate="show"
        transition={{ staggerChildren: 0.07, delayChildren: 0.04 }}
      >
        <motion.div variants={SETTLE} transition={{ type: "spring", stiffness: 400, damping: 36 }}>
          <Link
            href="/docs/understand/the-architecture"
            className="group inline-flex w-fit items-center rounded-full border border-fd-border bg-fd-card px-4 py-1.5 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-secondary/60"
          >
            <span className="font-mono text-fd-foreground">on(Trigger) → Effects</span>
            <ArrowRight
              className="size-3 w-0 opacity-0 transition-[width,opacity,transform,margin] duration-200 group-hover:ml-1.5 group-hover:w-3 group-hover:translate-x-0.5 group-hover:opacity-100"
              aria-hidden
            />
          </Link>
        </motion.div>

        <motion.h1
          className="pt-6 text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl xl:text-7xl"
          transition={{ staggerChildren: 0.08 }}
        >
          <span className="sr-only">
            A new programming model for backends. One law. Eight elements. One contract.
          </span>
          <span aria-hidden className="flex flex-col items-center">
            {BEATS.map((label) => (
              <motion.span
                key={label}
                className="block"
                variants={SETTLE}
                transition={{ type: "spring", stiffness: 340, damping: 32 }}
              >
                {label}
              </motion.span>
            ))}
          </span>
        </motion.h1>

        <motion.p
          variants={SETTLE}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
          className="max-w-2xl pt-5 text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base"
        >
          {TAGLINE}
        </motion.p>

        <motion.div
          variants={SETTLE}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
          className="flex flex-col items-stretch gap-3 pt-7 sm:flex-row sm:items-stretch sm:gap-2.5"
        >
          <Link
            href="/docs/understand/the-architecture"
            className="group inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-fd-foreground px-5 text-sm leading-none font-medium text-fd-background transition-opacity hover:opacity-90"
          >
            Read the architecture
            <ArrowRight
              aria-hidden
              className="ml-2 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </Link>

          <button
            type="button"
            onClick={() => void copyScaffold()}
            aria-label={copied ? "Scaffold command copied" : `Copy ${SCAFFOLD}`}
            className="group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-5 font-mono text-sm leading-none text-fd-muted-foreground transition-colors hover:bg-fd-secondary/60"
          >
            <span aria-hidden className="text-fd-muted-foreground/60 select-none">
              $
            </span>
            <span className="text-fd-foreground">{SCAFFOLD}</span>
            {copied ? (
              <Check aria-hidden className="size-3.5 text-fd-foreground" />
            ) : (
              <Copy
                aria-hidden
                className="size-3.5 text-fd-muted-foreground/60 transition-colors group-hover:text-fd-foreground"
              />
            )}
          </button>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}
