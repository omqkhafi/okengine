/**
 * Landing page band shell — a full-bleed section separated by horizontal rules,
 * matching the width the docs and changelog surfaces use. Layout pattern adapted
 * from better-auth/better-auth `docs/app/page.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida. See site/NOTICE.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Small monospace section marker shown at the top-left of a band.
 *
 * @param children - Label text (rendered uppercase)
 */
export function BandLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-fd-border px-5 py-3 sm:px-8">
      <span aria-hidden className="size-1 rounded-full bg-fd-muted-foreground/60" />
      <span className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
        {children}
      </span>
    </div>
  );
}

/**
 * One full-width section of the landing page.
 *
 * @param label - Optional section marker rendered above the content
 * @param className - Extra classes for the inner content wrapper
 * @param children - Section content
 */
export function Band({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-fd-border">
      {label ? <BandLabel>{label}</BandLabel> : null}
      <div className={cn("px-5 py-10 sm:px-8 sm:py-14", className)}>{children}</div>
    </section>
  );
}

/**
 * Band heading block — eyebrowless title plus optional supporting line.
 *
 * @param title - Section heading
 * @param children - Supporting copy
 */
export function BandHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h2>
      {children ? (
        <p className="max-w-2xl text-sm text-pretty text-fd-muted-foreground sm:text-base">
          {children}
        </p>
      ) : null}
    </div>
  );
}
