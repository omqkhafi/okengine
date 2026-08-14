/**
 * Spring-pressed motion button (beUI).
 *
 * @see https://beui.dev/components/motion/button
 */

import type { HTMLMotionProps } from "motion/react";
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease.ts";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable.ts";
import { AnimatePresence, motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** Visual treatment for {@link Button}. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";

/** Size token for {@link Button}. */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/** Props for {@link Button}. */
export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  /** Spawn a Material-style ripple from the press point. Off by default. */
  ripple?: boolean;
  children?: ReactNode;
}

type Ripple = { id: number; x: number; y: number; size: number };

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  ghost: "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
  outline: "border border-border bg-transparent text-foreground hover:bg-primary/5",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-xs",
  md: "h-10 gap-2 rounded-full px-5 text-sm",
  lg: "h-12 gap-2 rounded-full px-6 text-base",
  icon: "h-8 w-8 rounded-lg",
};

/**
 * Motion button with spring press, optional hover lift, and optional ripple.
 *
 * @param props - Variant, size, press scale, ripple, and button extras
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    pressScale = 0.93,
    ripple = false,
    className,
    children,
    onPointerDown,
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (ripple && !reduce) {
        const rect = event.currentTarget.getBoundingClientRect();
        const sizePx = Math.max(rect.width, rect.height) * 2;
        const id = nextId.current++;
        setRipples((prev) => [
          ...prev,
          {
            id,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            size: sizePx,
          },
        ]);
      }
      onPointerDown?.(event);
    },
    [ripple, reduce, onPointerDown],
  );

  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={reduce ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      onPointerDown={handlePointerDown}
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-colors outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        ripple && "relative overflow-hidden",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {ripple && !reduce ? (
        <AnimatePresence>
          {ripples.map((item) => (
            <motion.span
              key={item.id}
              className="absolute rounded-full bg-current"
              style={{
                left: item.x,
                top: item.y,
                width: item.size,
                height: item.size,
                x: "-50%",
                y: "-50%",
              }}
              initial={{ scale: 0.05, opacity: 0.3 }}
              animate={{ scale: 1, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.6, ease: EASE_OUT }}
              onAnimationComplete={() =>
                setRipples((prev) => prev.filter((entry) => entry.id !== item.id))
              }
            />
          ))}
        </AnimatePresence>
      ) : null}
      {children}
    </motion.button>
  );
});
