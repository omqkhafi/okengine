/**
 * Auth/setup — nested chassis + form plate.
 *
 * L0 = outer tray (muted well). CTA sits on this layer.
 * L1 = inner Card (title + fields) — inset from the tray lip.
 */

import { useId, type ReactNode } from "react";
import type { ButtonState } from "@/components/motion/button/index.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EASE_OUT } from "@/lib/ease.ts";
import { motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** L0 chassis — muted tray the form plate sits in. */
const authTrayClassName =
  "rounded-[1.5rem] bg-muted/60 ring-1 ring-foreground/8 dark:bg-muted/55 dark:ring-foreground/10";

/** L1 form plate — inset from the tray lip (raised in light, recessed in dark). */
const authPlateClassName =
  "rounded-2xl bg-card shadow-none ring-1 ring-foreground/8 dark:bg-background dark:ring-foreground/10";

/** Recessed well the submit key sits in — same width and radius as the plate. */
const authKeyWellClassName =
  "rounded-2xl bg-foreground/[0.04] p-1 ring-1 ring-inset ring-foreground/12 dark:bg-black/45 dark:ring-foreground/14";

/**
 * Submit control seated in {@link AuthCard} footer well.
 * Keycap bevel + press-in; keep in sync with the well radius (18px − 4px).
 */
export const authSubmitClassName =
  "h-11 w-full rounded-[14px] text-[15px] font-medium shadow-[inset_0_1px_0_0_oklch(1_0_0/0.22),inset_0_-1px_0_0_oklch(0_0_0/0.14)]";

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
  /** L1 body (fields, status copy). */
  children: ReactNode | ((ids: { titleId: string; descriptionId?: string }) => ReactNode);
  /** L0 footer (e.g. submit) — on the outer tray below L1. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Status LED + label for the auth plate eyebrow.
 *
 * @param props - Label and optional tone
 */
function AuthStatusRow({ label, tone = "neutral" }: AuthStatus) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-[1px]", statusToneClassName[tone])} />
      {label}
    </p>
  );
}

/**
 * Nested auth tray: form plate inset on a muted chassis, CTA on the tray.
 *
 * @param props - Title, optional status/description, L1 body, optional L0 footer
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
      data-auth-layer="0"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.42, ease: EASE_OUT }}
      className={cn("flex w-full flex-col gap-2 p-2", authTrayClassName, className)}
    >
      <Card
        data-auth-layer="1"
        className={cn("gap-7 py-7 pb-8 [--card-spacing:--spacing(7)]", authPlateClassName)}
      >
        <CardHeader className="gap-5">
          {status ? <AuthStatusRow {...status} /> : null}
          <div className="grid gap-2">
            <CardTitle id={titleId} className="tracking-[-0.02em]">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription
                id={descriptionId}
                className="text-[13px] leading-relaxed text-muted-foreground"
              >
                {description}
              </CardDescription>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {typeof children === "function" ? children({ titleId, descriptionId }) : children}
        </CardContent>
      </Card>

      {footer ? (
        <div data-auth-layer="footer" className={authKeyWellClassName}>
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
      data-auth-layer="0"
      className={cn("flex w-full flex-col gap-2 p-2", authTrayClassName)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Checking setup…</span>
      <Card
        data-auth-layer="1"
        className={cn("gap-7 py-7 pb-8 [--card-spacing:--spacing(7)]", authPlateClassName)}
      >
        <CardHeader className="gap-5">
          <Skeleton className="h-3 w-24" />
          <div className="grid gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[80%]" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div data-auth-layer="footer" className={authKeyWellClassName}>
        <Skeleton className="h-11 w-full rounded-[14px]" />
      </div>
    </div>
  );
}
