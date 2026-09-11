/**
 * Farm-style deck cards — numbered eyebrow, claim, nested visual well.
 * Hairline `gap-px` grid; equal-height cells; the well is the proof.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Hairline bento for homepage deck cards.
 *
 * @param children - {@link DeckCard} cells
 * @param className - Extra classes on the grid (column count, span)
 */
export function DeckGrid({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border lg:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One claim cell: `01.1 / FLOW`, heading, body, then a nested code or diagram well.
 *
 * @param index - Numbered marker (`01.1`)
 * @param kicker - Element or surface name (`FLOW`)
 * @param title - Card heading
 * @param body - One-line proof of the claim
 * @param visual - Nested well (code, simulator, terminal)
 * @param className - Extra classes on the article (column span)
 */
export function DeckCard({
  index,
  kicker,
  title,
  body,
  visual,
  className,
}: {
  readonly index: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly visual: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <article
      className={cn(
        "flex h-full min-h-[28rem] flex-col gap-5 bg-fd-card px-6 py-6 sm:px-8 sm:py-8",
        className,
      )}
    >
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
          {index} / {kicker}
        </p>
        <h3 className="text-xl font-semibold tracking-tight text-pretty sm:text-2xl">{title}</h3>
        <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
          {body}
        </p>
      </header>
      <div className="mt-auto flex min-h-[14rem] min-w-0 flex-1 flex-col [&_>_*]:h-full [&_>_*]:min-h-[14rem]">
        {visual}
      </div>
    </article>
  );
}
