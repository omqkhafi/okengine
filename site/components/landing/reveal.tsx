/**
 * Scroll reveal — quiet rise-and-settle as bands enter the viewport, once.
 * Reduced motion renders children plain (visible immediately).
 */

"use client";

import { MotionConfig, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/**
 * Wrap band content to animate it in on first scroll into view.
 *
 * @param children - Content to reveal
 * @param delay - Extra settle delay in seconds (stagger sibling reveals)
 * @param className - Classes applied to the motion wrapper
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly className?: string;
}): ReactNode {
  const reduced = useClientReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <MotionConfig reducedMotion="never">
      <motion.div
        className={className}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-8% 0px" }}
        transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.85, delay }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
