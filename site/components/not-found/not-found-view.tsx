/**
 * Site 404 — framed as a Flow that never matched a trigger.
 * One composition: brand, headline, path, unmatched-route visual, CTAs.
 */

"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OkeLogo } from "@/components/oke-logo";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const EASE = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

const column: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.04,
    },
  },
};

const settle: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: EASE },
};

const settleStatic: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0 } },
};

/**
 * Full-bleed not-found surface. Mounted under the root layout (topbar stays).
 */
export function NotFoundView() {
  const pathname = usePathname() || "/";
  const reduced = useClientReducedMotion();
  const settleVariants = reduced ? settleStatic : settle;
  const pathLiteral = JSON.stringify(pathname);

  return (
    <MotionConfig reducedMotion="never">
      <main className="relative flex min-h-[calc(100dvh-var(--landing-topbar-height))] flex-1 flex-col overflow-hidden border-b border-fd-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        >
          <div className="bg-noise-pattern size-full text-fd-foreground" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 size-[42rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at 40% 40%, color-mix(in oklch, var(--oke-el-flow) 28%, transparent), transparent 68%), radial-gradient(circle at 70% 55%, color-mix(in oklch, var(--oke-el-signal) 18%, transparent), transparent 62%)",
          }}
        />

        <motion.div
          className="relative z-[1] mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-16 sm:px-8 sm:py-20"
          variants={column}
          initial={reduced ? false : "hidden"}
          animate="show"
        >
          <motion.div variants={settleVariants}>
            <Link
              href="/"
              className="inline-flex w-fit text-fd-foreground transition-opacity hover:opacity-80"
              aria-label="okengine home"
            >
              <OkeLogo className="h-7 w-auto sm:h-8" />
            </Link>
          </motion.div>

          <motion.p
            variants={settleVariants}
            className="mt-8 font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase"
          >
            OKE0404 · flow.not_found
          </motion.p>

          <motion.h1
            variants={settleVariants}
            className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl xl:text-5xl"
          >
            No Flow matched.
          </motion.h1>

          <motion.p
            variants={settleVariants}
            className="mt-4 max-w-md text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base"
          >
            This path never reached a trigger — so nothing ran, and no effects were recorded.
          </motion.p>

          <motion.div variants={settleVariants} className="mt-10">
            <UnmatchedRoute pathLiteral={pathLiteral} reduced={reduced} />
          </motion.div>

          <motion.div
            variants={settleVariants}
            className="mt-10 flex flex-wrap items-center gap-2 sm:gap-3"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 bg-fd-primary px-5 py-2.5 text-xs font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 sm:text-sm"
            >
              Home
            </Link>
            <Link
              href="/docs"
              className="group relative inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground sm:text-sm"
            >
              <span
                className="absolute inset-0 opacity-[0.04] transition-opacity group-hover:opacity-[0.08]"
                style={{
                  backgroundImage: `repeating-linear-gradient(
                    -45deg,
                    transparent,
                    transparent 4px,
                    currentColor 4px,
                    currentColor 5px
                  )`,
                }}
                aria-hidden
              />
              <span className="relative">Documentation</span>
              <ArrowRight
                className="relative size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </motion.div>
        </motion.div>
      </main>
    </MotionConfig>
  );
}

/**
 * Dominant visual: a request enters, the dashed probe never lands on Effects.
 *
 * @param pathLiteral - JSON-stringified pathname for the trigger line
 * @param reduced - Prefer reduced motion
 */
function UnmatchedRoute({
  pathLiteral,
  reduced,
}: {
  pathLiteral: string;
  reduced: boolean;
}) {
  return (
    <figure
      className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/80"
      aria-label={`No Flow matched on(http.get(${pathLiteral}))`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-5">
        <p className="min-w-0 break-all font-mono text-sm font-medium text-fd-foreground">
          on(http.get({pathLiteral})) → Effects
        </p>
        <code className="shrink-0 font-mono text-[11px] text-fd-muted-foreground">unmatched</code>
      </div>

      <div className="grid gap-px bg-fd-border sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-2 bg-fd-card px-4 py-5 sm:px-5">
          <span className="font-mono text-[10px] text-fd-muted-foreground/70">01</span>
          <p className="text-sm font-medium text-fd-foreground">Trigger</p>
          <code className="w-fit max-w-full truncate rounded border border-fd-border bg-fd-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-fd-muted-foreground">
            http.get({pathLiteral})
          </code>
        </div>

        <div className="relative flex items-center justify-center bg-fd-card px-4 py-4 sm:min-w-[7.5rem] sm:px-2">
          <svg
            viewBox="0 0 120 24"
            className="h-6 w-full max-w-[10rem] text-fd-muted-foreground"
            aria-hidden
          >
            <line
              x1="4"
              y1="12"
              x2="116"
              y2="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 5"
              opacity="0.35"
            />
            <line
              x1="4"
              y1="12"
              x2="116"
              y2="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="10 18"
              className={reduced ? undefined : "oke-route-probe"}
              opacity={reduced ? 0.2 : 0.85}
            />
            <circle cx="4" cy="12" r="2.5" fill="currentColor" opacity="0.7" />
            <circle
              cx="116"
              cy="12"
              r="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.45"
              className={reduced ? undefined : "oke-route-miss"}
            />
          </svg>
          <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-mono text-[10px] tracking-wide text-fd-muted-foreground/70 uppercase sm:bottom-3">
            no match
          </span>
        </div>

        <div className="flex flex-col gap-2 bg-fd-card px-4 py-5 sm:px-5">
          <span className="font-mono text-[10px] text-fd-muted-foreground/70">02</span>
          <p className="text-sm font-medium text-fd-foreground">Effects</p>
          <code className="w-fit rounded border border-dashed border-fd-border px-1.5 py-0.5 font-mono text-[10px] text-fd-muted-foreground/70">
            ∅ empty
          </code>
        </div>
      </div>
    </figure>
  );
}
