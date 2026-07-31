/**
 * Shared scroll-reveal for docs visuals — one staggered cascade when a figure
 * scrolls into view, plus an optional hover lift on cards.
 *
 * House motion rules (see collapse-diagram / features): gate through
 * `useClientReducedMotion` and keep MotionConfig at `"never"` so Motion does
 * not refuse transform animates under the OS preference — reduced motion
 * renders the final frame with no animation at all.
 */

"use client";

import { MotionConfig, motion, type Transition, type Variants } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/** Snappy settle — a cascade, not a bounce. */
const REVEAL: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.7 };

/** Parent state: no visual change of its own, just the stagger clock. */
const LIST: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

/** One item arriving: a short rise and fade. */
const ITEM: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

const GROUP_TAG = { div: motion.div, ul: motion.ul, ol: motion.ol } as const;
const ITEM_TAG = { div: motion.div, li: motion.li, ul: motion.ul, ol: motion.ol } as const;

/**
 * Cascade container — RevealItem children arrive in DOM order the first time
 * the group scrolls into view. Reduced motion skips the cascade entirely.
 */
export function RevealGroup({
  as = "div",
  className,
  children,
}: {
  readonly as?: keyof typeof GROUP_TAG;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const reduced = useClientReducedMotion();
  const Tag = GROUP_TAG[as];
  return (
    <MotionConfig reducedMotion="never">
      <Tag
        className={className}
        variants={LIST}
        initial={reduced ? false : "hidden"}
        whileInView={reduced ? undefined : "show"}
        viewport={{ once: true, margin: "-8% 0px" }}
      >
        {children}
      </Tag>
    </MotionConfig>
  );
}

/**
 * One cascade item. `lift` adds a small hover raise — for parallel cards the
 * reader can pick between, not for ordered pipeline rows.
 */
export function RevealItem({
  as = "div",
  lift = false,
  className,
  children,
}: {
  readonly as?: keyof typeof ITEM_TAG;
  readonly lift?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const reduced = useClientReducedMotion();
  const Tag = ITEM_TAG[as];
  return (
    <Tag
      className={className}
      variants={ITEM}
      transition={REVEAL}
      whileHover={reduced || !lift ? undefined : { y: -3 }}
    >
      {children}
    </Tag>
  );
}

/**
 * Deterministic ambient clock for docs micro-simulations — a trigger firing,
 * a request token traversing a pipeline, a probe descending a chain.
 *
 * Ever-increasing, starting at 0 on both server and client so hydration
 * matches; the interval only starts after mount. Returns `null` under reduced
 * motion — callers render a static snapshot instead of a live beat.
 *
 * @param ms - Beat period
 */
export function useTick(ms: number): number | null {
  const reduced = useClientReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [reduced, ms]);
  return reduced ? null : tick;
}

/**
 * One-shot ripple emitted when a beat lands — re-mount (via `key`) on each
 * activation so it plays once per landing. Absolutely positioned inside a
 * relative dot wrapper.
 */
export function BeatPing({ className }: { readonly className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-full ${className ?? ""}`}
      initial={{ scale: 0.6, opacity: 0.9 }}
      animate={{ scale: 2.4, opacity: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    />
  );
}
