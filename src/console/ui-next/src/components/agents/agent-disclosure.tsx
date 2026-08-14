/**
 * Shared transform-only reveal for collapsible agent content (beUI).
 *
 * @see https://beui.dev/components/agents/file-diff
 */

import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";
import type { CSSProperties, JSX } from "react";
import { EASE_OUT } from "@/lib/ease.ts";
import { cn } from "@/lib/utils.ts";

/** Props for {@link AgentDisclosure}. */
export interface AgentDisclosureProps extends Omit<HTMLMotionProps<"div">, "animate" | "initial"> {
  readonly open: boolean;
  readonly openHeight?: CSSProperties["height"];
}

/**
 * Clip-path height reveal used by File Diff and other agent surfaces.
 *
 * @param props - Open state + motion div extras
 */
export function AgentDisclosure({
  open,
  openHeight = "auto",
  className,
  style,
  transition,
  ...props
}: AgentDisclosureProps): JSX.Element {
  const reduce = useReducedMotion() ?? false;

  return (
    <motion.div
      {...props}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      initial={false}
      animate={
        reduce
          ? { opacity: open ? 1 : 0 }
          : {
              opacity: open ? 1 : 0,
              clipPath: open ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
              y: open ? 0 : -4,
            }
      }
      transition={
        transition ?? {
          duration: reduce ? 0 : open ? 0.22 : 0.14,
          ease: EASE_OUT,
        }
      }
      className={cn("overflow-hidden", className)}
      style={{
        ...style,
        height: open ? openHeight : 0,
        pointerEvents: open ? undefined : "none",
        transformOrigin: "top",
      }}
    />
  );
}
