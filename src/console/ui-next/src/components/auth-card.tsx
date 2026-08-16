/**
 * Auth/setup gate — wordmark lives in ConsoleChrome; this is the lock plate.
 * Hairline plate + status rail + ink key as a sibling below. Not an explorer strip.
 */

import { Cancel01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, type ReactNode } from "react";
import {
  ExpandingArrowButton,
  type ExpandingArrowButtonProps,
  type ButtonState,
} from "@/components/motion/button/index.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { EASE_OUT } from "@/lib/ease.ts";
import { motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** Lock plate — hairline frame on all four sides. */
export const authPlateClassName =
  "flex w-full flex-col rounded-none border border-border bg-card text-card-foreground";

/** Ledger stack — full-bleed rules that meet the plate. */
export const authFieldGroupClassName = "gap-0 border-t border-border/60";

/** Instrument row — label left, value right. Last row stays open (plate closes it). */
export const authFieldRowClassName =
  "grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border/60 px-5 py-3.5 last:border-b-0 data-[invalid=true]:border-destructive";

/** Bare value — no underline. Autofill stays transparent. */
export const authFieldClassName =
  "h-8 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent autofill:bg-transparent autofill:shadow-none";

/** Error / meter under the value, not under the label. */
export const authFieldValueClassName = "col-start-2 min-w-0";

/** Field label — uppercase instrument; inks when the row is focused. */
export const authLabelClassName =
  "text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase group-focus-within/field:text-foreground";

/** Hold success cascade on the submit key before navigating away. */
export const AUTH_SUBMIT_SUCCESS_MS = 650;

/**
 * Map a mutation into the auth submit lifecycle.
 *
 * @param status - Pending / success / error flags
 */
export function authSubmitState(status: {
  pending: boolean;
  success: boolean;
  error: boolean;
}): ButtonState {
  if (status.pending) return "loading";
  if (status.success) return "success";
  if (status.error) return "error";
  return "idle";
}

/** Props for {@link AuthSubmitButton}. */
export type AuthSubmitButtonProps = Omit<ExpandingArrowButtonProps, "children" | "expand"> & {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
};

/**
 * Gate submit — expanding arrow while idle; icon + copy when busy.
 *
 * @param props - Mutation state, slot copy, and button extras
 */
export function AuthSubmitButton({
  state = "idle",
  children,
  loadingText = "Loading",
  successText = "Done",
  errorText = "Try again",
  disabled,
  ...rest
}: AuthSubmitButtonProps) {
  const isBusy = state === "loading";
  const label =
    state === "loading"
      ? loadingText
      : state === "success"
        ? successText
        : state === "error"
          ? errorText
          : children;
  const icon =
    state === "loading"
      ? Loading03Icon
      : state === "success"
        ? Tick02Icon
        : state === "error"
          ? Cancel01Icon
          : null;

  return (
    <ExpandingArrowButton
      disabled={disabled || isBusy}
      expand={state === "idle"}
      aria-busy={isBusy || undefined}
      data-slot="auth-submit"
      {...rest}
    >
      <span className="inline-flex items-center gap-2">
        {icon ? (
          <HugeiconsIcon
            icon={icon}
            size={16}
            color="currentColor"
            strokeWidth={1.5}
            className={state === "loading" ? "animate-spin" : undefined}
            aria-hidden
          />
        ) : null}
        {label}
      </span>
    </ExpandingArrowButton>
  );
}

const statusToneClassName = {
  neutral: "bg-foreground/35",
  open: "bg-foreground",
  alert: "bg-destructive",
} as const;

type AuthStatusTone = keyof typeof statusToneClassName;

type AuthStatus = {
  label: string;
  tone?: AuthStatusTone;
};

type AuthCardProps = {
  title: string;
  description?: string;
  /** Instrument eyebrow — setup state, not decoration. */
  status?: AuthStatus;
  /** Field body. */
  children: ReactNode | ((ids: { titleId: string; descriptionId?: string }) => ReactNode);
  /** Ink key — sibling below the plate, not inside it. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Status LED + label as the plate's top rail.
 *
 * @param props - Label and optional tone
 */
function AuthStatusRow({ label, tone = "neutral" }: AuthStatus) {
  return (
    <p
      className={cn(
        authLabelClassName,
        "flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 px-5 group-focus-within/field:text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-[1px]", statusToneClassName[tone])} />
      {label}
    </p>
  );
}

const plateTickClassName = "pointer-events-none absolute size-3 border-foreground/50";

/**
 * Calibration ticks — frame the whole lock (plate + key), not the plate alone.
 */
function AuthPlateTicks() {
  return (
    <>
      <span
        aria-hidden
        className={cn(plateTickClassName, "-top-1.5 -left-1.5 border-t border-l")}
      />
      <span
        aria-hidden
        className={cn(plateTickClassName, "-top-1.5 -right-1.5 border-t border-r")}
      />
      <span
        aria-hidden
        className={cn(plateTickClassName, "-bottom-1.5 -left-1.5 border-b border-l")}
      />
      <span
        aria-hidden
        className={cn(plateTickClassName, "-right-1.5 -bottom-1.5 border-r border-b")}
      />
    </>
  );
}

/**
 * Operator gate: plate (status, title, ledger) and a separate ink key below.
 *
 * @param props - Title, optional status/description, body, optional footer
 */
export function AuthCard({
  title,
  description,
  status,
  children,
  footer,
  className,
}: AuthCardProps) {
  const reactId = useId();
  const titleId = `auth-title-${reactId}`;
  const descriptionId = description ? `auth-desc-${reactId}` : undefined;
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <motion.div
      data-slot="auth-card"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.42, ease: EASE_OUT }}
      className={cn("relative flex w-full flex-col gap-4", className)}
    >
      <AuthPlateTicks />
      <div data-auth-layer="0" className={authPlateClassName}>
        {status ? <AuthStatusRow {...status} /> : null}

        <header
          data-auth-layer="1"
          className={cn("flex flex-col gap-3 px-5", status ? "pt-7" : "pt-6")}
        >
          <h1
            id={titleId}
            className="text-[1.75rem] leading-none font-semibold tracking-[-0.03em] text-foreground"
          >
            {title}
          </h1>
          {description ? (
            <p id={descriptionId} className="text-[13px] leading-snug text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>

        <div className="mt-7 flex flex-col pb-1">
          {typeof children === "function" ? children({ titleId, descriptionId }) : children}
        </div>
      </div>

      {footer ? (
        <div data-auth-layer="footer" className="w-full">
          {footer}
        </div>
      ) : null}
    </motion.div>
  );
}

/**
 * Skeleton placeholder matching {@link AuthCard} while setup status loads.
 */
export function AuthCardSkeleton() {
  return (
    <div
      data-slot="auth-card"
      className="relative flex w-full flex-col gap-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Checking setup…</span>
      <AuthPlateTicks />
      <div data-auth-layer="0" className={authPlateClassName}>
        <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-5">
          <Skeleton className="h-3 w-24 rounded-none" />
        </div>
        <header data-auth-layer="1" className="flex flex-col gap-3 px-5 pt-7">
          <Skeleton className="h-7 w-36 rounded-none" />
          <Skeleton className="h-4 w-full rounded-none" />
        </header>
        <div className="mt-7 flex flex-col border-t border-border/60 pb-1">
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 border-b border-border/60 px-5 py-3.5 last:border-b-0"
            >
              <Skeleton className="h-3 w-14 rounded-none" />
              <Skeleton className="h-8 w-full rounded-none" />
            </div>
          ))}
        </div>
      </div>
      <div data-auth-layer="footer" className="w-full">
        <Skeleton className="h-11 w-full rounded-none" />
      </div>
    </div>
  );
}
