/**
 * Auth/setup — two connected layers, login plate colors.
 *
 * L0 = outer muted plate; CTA sits on this layer.
 * L1 = inner Card (title + fields) — same muted tokens as L0 / login.
 */

import { useId, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Login shell colors — shared by L0 and L1. */
const authPlateClassName =
  "rounded-2xl bg-muted/30 ring-1 ring-muted-foreground/10 dark:bg-muted/20";

type AuthCardProps = {
  title: string;
  description?: string;
  /** L1 body (fields, status copy). */
  children: ReactNode | ((ids: { titleId: string; descriptionId?: string }) => ReactNode);
  /** L0 footer (e.g. submit) — on the outer plate below L1. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Connected auth layers with the same muted plate colors as login.
 *
 * @param props - Title, optional description, L1 body, optional L0 footer
 */
export function AuthCard({ title, description, children, footer, className }: AuthCardProps) {
  const reactId = useId();
  const titleId = `auth-title-${reactId}`;
  const descriptionId = description ? `auth-desc-${reactId}` : undefined;

  return (
    <div
      data-auth-layer="0"
      className={cn("flex w-full flex-col gap-6 px-0 pt-0 pb-6", authPlateClassName, className)}
    >
      <Card
        data-auth-layer="1"
        className={cn("gap-(--card-spacing) shadow-none", authPlateClassName)}
      >
        <CardHeader>
          <CardTitle id={titleId}>{title}</CardTitle>
          {description ? <CardDescription id={descriptionId}>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {typeof children === "function" ? children({ titleId, descriptionId }) : children}
        </CardContent>
      </Card>

      {footer ? <div className="flex flex-col gap-3 px-6">{footer}</div> : null}
    </div>
  );
}

/**
 * Skeleton placeholder matching {@link AuthCard} while setup status loads.
 */
export function AuthCardSkeleton() {
  return (
    <div
      data-auth-layer="0"
      className={cn("flex w-full flex-col gap-6 px-0 pt-0 pb-6", authPlateClassName)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Checking setup…</span>
      <Card
        data-auth-layer="1"
        className={cn("gap-(--card-spacing) shadow-none", authPlateClassName)}
      >
        <CardHeader>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[80%]" />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3 px-6">
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
