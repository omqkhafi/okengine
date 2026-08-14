/**
 * Animated checkbox used by the motion Table (beUI).
 */

import { useId, type JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "@/lib/motion.ts";
import { EASE_OUT } from "@/lib/ease.ts";
import { cn } from "@/lib/utils.ts";

const CHECK_PATH = "M5 13l4 4L19 7";
const INDETERMINATE_PATH = "M6 12h12";

/** Props for {@link Checkbox}. */
export interface CheckboxProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly indeterminate?: boolean;
  readonly label?: string;
  readonly className?: string;
  readonly id?: string;
  readonly "aria-label"?: string;
  /** Associates an external message (e.g. a form error) with the control. */
  readonly "aria-describedby"?: string;
}

/**
 * Motion checkbox with checked / indeterminate marks.
 *
 * @param props - Checked state + change handler
 */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  indeterminate,
  label,
  className,
  id: idProp,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: CheckboxProps): JSX.Element {
  const autoId = useId();
  const id = idProp ?? autoId;
  const reduce = useReducedMotion();
  const showMark = checked || indeterminate;
  const path = indeterminate ? INDETERMINATE_PATH : CHECK_PATH;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex items-center gap-3",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <motion.button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked);
        }}
        whileTap={reduce || disabled ? undefined : { scale: 0.94 }}
        transition={{ duration: 0.12, ease: EASE_OUT }}
        data-state={checked ? "checked" : indeterminate ? "indeterminate" : "unchecked"}
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border-2 outline-none transition-colors duration-200",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-60",
          showMark
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 bg-background hover:border-muted-foreground",
        )}
      >
        <AnimatePresence initial={false}>
          {showMark ? (
            <motion.svg
              key={indeterminate ? "indeterminate" : "checked"}
              className="pointer-events-none absolute inset-0 m-auto block size-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.5 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              transition={reduce ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }}
              aria-hidden
            >
              <title>{indeterminate ? "Partially selected" : "Selected"}</title>
              <motion.path
                d={path}
                initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        duration: indeterminate ? 0.2 : 0.3,
                        ease: EASE_OUT,
                        delay: 0.04,
                      }
                }
              />
            </motion.svg>
          ) : null}
        </AnimatePresence>
      </motion.button>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
