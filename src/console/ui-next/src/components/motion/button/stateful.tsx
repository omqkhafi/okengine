/**
 * Idle → loading → success / error button with blur-swap slots (beUI).
 *
 * @see https://beui.dev/components/motion/button#stateful
 */

import { Cancel01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Variants } from "motion/react";
import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/motion/button/base.tsx";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease.ts";
import { AnimatePresence, motion, useReducedMotion } from "@/lib/motion.ts";

/** Lifecycle for {@link StatefulButton}. */
export type ButtonState = "idle" | "loading" | "success" | "error";

/** Props for {@link StatefulButton}. */
export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}

const CASCADE_STAGGER = 0.025;
const ROLL_BLUR = "blur(6px)";

const CASCADE_LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%", filter: ROLL_BLUR },
  animate: (delay = 0) => ({
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay = 0) => ({
    opacity: 0,
    y: "-105%",
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};

const ICON_VARIANTS: Variants = {
  initial: { opacity: 0, width: 0, scale: 0.7, filter: ROLL_BLUR },
  animate: {
    opacity: 1,
    width: "1.5rem",
    scale: 1,
    filter: "blur(0px)",
    transition: SPRING_SWAP,
  },
  exit: {
    opacity: 0,
    width: 0,
    scale: 0.7,
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT },
  },
};

function IconSlot({ keyId, children }: { keyId: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={keyId}
      variants={ICON_VARIANTS}
      initial={reduce ? { opacity: 0 } : "initial"}
      animate={reduce ? { opacity: 1 } : "animate"}
      exit={reduce ? { opacity: 0 } : "exit"}
      transition={reduce ? { duration: 0.15 } : undefined}
      className="inline-grid shrink-0 place-items-center overflow-hidden"
    >
      {children}
    </motion.span>
  );
}

function TextSlot({ value, children }: { value: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const label = typeof children === "string" ? children : null;
  const cascade = label !== null && !reduce;

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;
    if (!nextWidth) return;
    setWidth((current) => (current === nextWidth ? current : nextWidth));
  });

  return (
    <motion.span
      initial={false}
      animate={{ width }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="relative inline-block overflow-hidden align-bottom whitespace-nowrap"
    >
      <span ref={measureRef} aria-hidden className="invisible inline-block whitespace-nowrap">
        {cascade
          ? label.split("").map((char, index) => (
              <span key={index} className="inline-block whitespace-pre">
                {char}
              </span>
            ))
          : children}
      </span>

      {cascade ? (
        <>
          <span className="sr-only">{label}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={`cascade-${value}`}
              aria-hidden
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute top-0 left-0 inline-block whitespace-pre"
            >
              {label.split("").map((char, index) => (
                <motion.span
                  key={index}
                  custom={index * CASCADE_STAGGER}
                  variants={CASCADE_LETTER_VARIANTS}
                  className="inline-block whitespace-pre will-change-[opacity,filter,transform]"
                >
                  {char}
                </motion.span>
              ))}
            </motion.span>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence initial={false}>
          <motion.span
            key={`text-${value}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, filter: ROLL_BLUR }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14, filter: ROLL_BLUR }}
            transition={reduce ? { duration: 0.15 } : SPRING_SWAP}
            className="absolute top-0 left-0 inline-block will-change-[opacity,filter,transform]"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </motion.span>
  );
}

/**
 * Button that swaps idle / loading / success / error with a letter cascade.
 *
 * @param props - State, slot copy, and {@link Button} extras
 */
export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(
  function StatefulButton(
    {
      state = "idle",
      children,
      loadingText = "Loading",
      successText = "Done",
      errorText = "Try again",
      icon,
      disabled,
      ...rest
    },
    ref,
  ) {
    const isBusy = state === "loading";
    const stateText =
      state === "loading"
        ? loadingText
        : state === "success"
          ? successText
          : state === "error"
            ? errorText
            : children;
    const textKey = typeof stateText === "string" ? `${state}-${stateText}` : state;

    return (
      <Button
        ref={ref}
        disabled={disabled || isBusy}
        aria-busy={isBusy || undefined}
        whileHover={undefined}
        {...rest}
      >
        <span
          aria-live="polite"
          className="relative inline-flex items-center justify-center overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {state === "loading" ? (
              <IconSlot keyId="loading-icon">
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={16}
                  color="currentColor"
                  strokeWidth={1.5}
                  className="animate-spin"
                  aria-hidden
                />
              </IconSlot>
            ) : null}
            {state === "success" ? (
              <IconSlot keyId="success-icon">
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={16}
                  color="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </IconSlot>
            ) : null}
            {state === "error" ? (
              <IconSlot keyId="error-icon">
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={16}
                  color="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </IconSlot>
            ) : null}
          </AnimatePresence>

          <TextSlot value={textKey}>{stateText}</TextSlot>

          <AnimatePresence initial={false}>
            {state === "idle" && icon ? <IconSlot keyId="idle-icon">{icon}</IconSlot> : null}
          </AnimatePresence>
        </span>
      </Button>
    );
  },
);
