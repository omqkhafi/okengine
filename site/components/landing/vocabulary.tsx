/**
 * Ten exports — the whole public vocabulary, listed with the role of each name.
 * Original okengine section (unified-theory §6). Cards settle on scroll with
 * a pointer spotlight.
 */

"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import type { MouseEvent, ReactNode } from "react";
import { EXPORTS } from "@/lib/elements";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 32, mass: 0.75 },
  },
};

/** Feed the card's spotlight radial with pointer coordinates (CSS vars). */
function trackSpotlight(event: MouseEvent<HTMLLIElement>): void {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
  card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
}

/**
 * Grid of the ten exported names and what each one is for.
 */
export function Vocabulary(): ReactNode {
  const reduced = useClientReducedMotion();

  return (
    <div className="@container not-prose w-full max-w-full min-w-0">
      <MotionConfig reducedMotion="never">
        <motion.ul
          className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border @min-[48rem]:grid-cols-5"
          variants={list}
          initial={reduced ? false : "hidden"}
          whileInView={reduced ? undefined : "show"}
          viewport={{ once: true, margin: "-8% 0px" }}
        >
          {EXPORTS.map((entry, i) => (
            <motion.li
              key={entry.name}
              variants={item}
              onMouseMove={trackSpotlight}
              className="sently-spotlight flex min-w-0 flex-col gap-1 bg-fd-card px-3 py-3 sm:px-4 sm:py-3.5"
            >
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-sm font-medium text-fd-foreground">
                  {entry.name}
                </code>
                <span className="shrink-0 font-mono text-[10px] text-fd-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="text-[11px] leading-snug text-pretty text-fd-muted-foreground">
                {entry.role}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </MotionConfig>
    </div>
  );
}
