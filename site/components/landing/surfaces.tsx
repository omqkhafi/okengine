/**
 * Four dev surfaces — app, Console, MCP, docs MCP. Original okengine section
 * (README / `docs/spec/console.md`); the mnemonic is O·K·E = 6·5·3.
 * Cards settle on scroll with a pointer spotlight and a live heartbeat.
 */

"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import type { MouseEvent, ReactNode } from "react";
import { PORTS } from "@/lib/elements";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
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
 * Port cards for the surfaces `oke dev` brings up together.
 */
export function Surfaces(): ReactNode {
  const reduced = useClientReducedMotion();

  return (
    <div className="@container not-prose relative w-full max-w-full min-w-0">
      <span
        aria-hidden
        className="sently-beam-x pointer-events-none absolute -top-px z-[1] hidden h-px w-16 bg-linear-to-r from-transparent via-fd-foreground/60 to-transparent lg:block"
      />
      <MotionConfig reducedMotion="never">
        <motion.ul
          className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border @min-[28rem]:grid-cols-2 @min-[48rem]:grid-cols-4"
          variants={list}
          initial={reduced ? false : "hidden"}
          whileInView={reduced ? undefined : "show"}
          viewport={{ once: true, margin: "-8% 0px" }}
        >
          {PORTS.map((surface) => (
            <motion.li
              key={surface.port}
              variants={item}
              onMouseMove={trackSpotlight}
              className="sently-spotlight flex min-w-0 flex-col gap-2 bg-fd-card px-4 py-4 sm:px-5 sm:py-5"
            >
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code className="font-mono text-2xl leading-none font-medium tracking-tight text-fd-foreground">
                    :{surface.port}
                  </code>
                  <h3 className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                    {surface.surface}
                  </h3>
                </div>
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                  <span
                    aria-hidden
                    className="sently-dot-pulse size-1 rounded-full bg-fd-foreground/60"
                  />
                  live
                </span>
              </div>
              <p className="text-sm leading-snug text-pretty text-fd-muted-foreground">
                {surface.detail}
              </p>
            </motion.li>
          ))}
        </motion.ul>
      </MotionConfig>
    </div>
  );
}
