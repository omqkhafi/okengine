/**
 * Animated switch with a spring-driven thumb (beUI).
 *
 * @see https://beui.dev/components/motion/switch
 */

import { useEffect, useId, useRef, useState, type JSX } from "react";
import { animate, motion, MotionConfig, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** Heavy, deliberate thumb — high mass keeps the travel weighty without wobble. */
const THUMB_SPRING = { type: "spring", stiffness: 800, damping: 80, mass: 4 } as const;

/** Props for {@link Switch}. */
export interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  /** `sm` fits the Store grid row; default matches beUI. */
  readonly size?: "sm" | "default";
}

/**
 * Motion switch with press squish and a disabled shake.
 *
 * @param props - Checked state + change handler
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  ariaLabel,
  className,
  size = "default",
}: SwitchProps): JSX.Element {
  const id = useId();
  const thumbRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [isPressed, setIsPressed] = useState(false);
  const [isPointer, setIsPointer] = useState(false);
  const compact = size === "sm";

  useEffect(() => {
    if (!thumbRef.current || reduce) return;
    if (disabled && isPressed) {
      animate(thumbRef.current, { x: [0, -2, 2, -1, 0] }, { delay: 0.2, duration: 0.6 });
    }
  }, [disabled, isPressed, reduce]);

  const squish = !disabled && isPointer && isPressed && !reduce;

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={cn("inline-flex items-center gap-2", className)}>
        <motion.button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onCheckedChange(!checked);
          }}
          onPointerDown={() => {
            setIsPressed(true);
            setIsPointer(true);
          }}
          onPointerUp={() => setIsPressed(false)}
          onPointerLeave={() => setIsPressed(false)}
          initial={false}
          data-state={checked ? "checked" : "unchecked"}
          className={cn(
            "group peer inline-flex shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
            compact ? "h-4 w-7 px-0.5" : "h-7 w-12 px-1",
            checked ? "justify-end bg-primary" : "justify-start bg-muted-foreground/60",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout
            animate={{ scale: squish ? 0.9 : 1 }}
            className={cn(
              "pointer-events-none block rounded-full bg-background shadow-md",
              compact ? "h-3 w-3" : "h-5 w-5",
            )}
          >
            <div
              className={cn(compact ? "size-3" : "size-5", squish && (checked ? "ml-1" : "mr-1"))}
              aria-hidden
            />
          </motion.div>
        </motion.button>
        {label ? (
          <label htmlFor={id} className="text-sm">
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
}
