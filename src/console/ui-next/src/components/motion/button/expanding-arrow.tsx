/**
 * Expanding-arrow CTA — beUI motion, Console gate chrome.
 *
 * @see https://beui.dev/components/motion/expanding-arrow-button#expanding-arrow
 */

import type { HTMLMotionProps } from "motion/react";
import { forwardRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { EASE_OUT, SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease.ts";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable.ts";
import { motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** Props for {@link ExpandingArrowButton}. */
export interface ExpandingArrowButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children: ReactNode;
  /** Expanding fill (defaults to page ink on the inverse key). */
  accentClassName?: string;
  /** Idle label. */
  labelClassName?: string;
  /** When false, the tile stays put (busy / success / error). */
  expand?: boolean;
}

const ARROW_OPACITY = [1, 0.78, 0.54, 0.32, 0.16] as const;
/** Square tile inside `p-1` on an h-11 key. */
const IDLE_TILE_PX = 36;

/**
 * Five-dot chevron used as the idle mark and the hover trail.
 *
 * @param props - Optional size classes
 */
function DottedChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 28" fill="none" aria-hidden className={className}>
      <circle cx="4" cy="4" r="2" fill="currentColor" />
      <circle cx="10" cy="9" r="2" fill="currentColor" />
      <circle cx="16" cy="14" r="2" fill="currentColor" />
      <circle cx="10" cy="19" r="2" fill="currentColor" />
      <circle cx="4" cy="24" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Full-width ink key: page-ink tile expands into a dotted-arrow trail on hover/focus.
 *
 * @param props - Label, optional accent/label classes, expand lock
 */
export const ExpandingArrowButton = forwardRef<HTMLButtonElement, ExpandingArrowButtonProps>(
  function ExpandingArrowButton(
    {
      children,
      className,
      accentClassName,
      labelClassName,
      expand = true,
      disabled,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const reduce = useReducedMotion();
    const canHover = useHoverCapable();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const active = Boolean(expand && !disabled && ((canHover && hovered) || focused));
    const layoutTransition = reduce ? { duration: 0 } : SPRING_LAYOUT;

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={disabled}
        onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => {
          setHovered(true);
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event: MouseEvent<HTMLButtonElement>) => {
          setHovered(false);
          onMouseLeave?.(event);
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event: FocusEvent<HTMLButtonElement>) => {
          setFocused(false);
          onBlur?.(event);
        }}
        whileTap={reduce || disabled ? undefined : { scale: 0.98 }}
        transition={SPRING_PRESS}
        className={cn(
          "relative inline-flex h-11 w-full items-center overflow-hidden rounded-none bg-primary p-1 text-primary-foreground select-none",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {expand ? (
          <motion.span
            layout="size"
            aria-hidden
            transition={layoutTransition}
            style={{
              width: active ? "calc(100% - 8px)" : IDLE_TILE_PX,
              borderRadius: 0,
            }}
            className={cn(
              "absolute inset-y-1 left-1 z-10 overflow-hidden bg-background text-foreground",
              accentClassName,
            )}
          >
            <motion.span
              animate={{ opacity: active ? 0 : 1 }}
              transition={{ duration: reduce ? 0 : 0.1, ease: EASE_OUT }}
              className="absolute inset-0 grid place-items-center"
            >
              <DottedChevron className="h-5 w-3.5" />
            </motion.span>

            <span className="absolute inset-0 flex items-center justify-around px-3">
              {ARROW_OPACITY.map((opacity, index) => (
                <motion.span
                  key={opacity}
                  animate={{
                    opacity: active ? opacity : 0,
                    transform: active && !reduce ? "translateX(0px)" : "translateX(-6px)",
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.18,
                    delay: active && !reduce ? 0.04 + index * 0.025 : 0,
                    ease: EASE_OUT,
                  }}
                  className="inline-grid place-items-center"
                >
                  <DottedChevron className="h-5 w-3.5" />
                </motion.span>
              ))}
            </span>
          </motion.span>
        ) : null}

        <motion.span
          animate={{
            opacity: active ? 0 : 1,
            transform: active && !reduce ? "translateX(6px)" : "translateX(0px)",
          }}
          transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
          className={cn(
            "relative z-0 flex w-full items-center justify-center text-sm font-medium text-primary-foreground",
            expand && "pr-3 pl-11",
            labelClassName,
          )}
        >
          {children}
        </motion.span>
      </motion.button>
    );
  },
);
