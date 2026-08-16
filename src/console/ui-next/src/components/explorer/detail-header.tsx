/**
 * Inspector identity header — Store / Vault / Flows share one chrome.
 */

import type { CSSProperties, JSX, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import {
  DETAIL_HEADER_CLASS,
  DETAIL_TITLE_CLASS,
  EXPLORER_ICON_CLASS,
  explorerIconInk,
} from "./explorer-chrome.ts";

/** Props for {@link DetailHeader}. */
export interface DetailHeaderProps {
  readonly icon: ReactNode;
  readonly wellClassName?: string;
  readonly wellStyle?: CSSProperties;
  readonly title: ReactNode;
  readonly badge?: ReactNode;
  readonly subtitle?: ReactNode;
  /** First control — typically collapse / expand the start explorer. */
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  readonly sticky?: boolean;
  readonly className?: string;
  readonly dataSlot?: string;
}

/**
 * Monitoring-style identity strip: centered identity, stretch actions.
 *
 * @param props - Identity + actions
 */
export function DetailHeader({
  icon,
  wellClassName,
  wellStyle,
  title,
  badge,
  subtitle,
  leading,
  actions,
  sticky = false,
  className,
  dataSlot = "detail-header",
}: DetailHeaderProps): JSX.Element {
  return (
    <header
      className={cn(DETAIL_HEADER_CLASS, sticky && "sticky top-0 z-10", className)}
      data-slot={dataSlot}
    >
      {leading ? (
        <div className="-ml-2 flex h-full shrink-0 items-stretch">
          {leading}
          <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            EXPLORER_ICON_CLASS,
            "flex shrink-0 items-center justify-center",
            explorerIconInk(wellClassName ?? "text-muted-foreground"),
          )}
          style={wellStyle?.color ? { color: wellStyle.color } : undefined}
          aria-hidden
        >
          {icon}
        </span>
        <h2 className={cn(DETAIL_TITLE_CLASS, "leading-none")}>{title}</h2>
        {badge ? (
          <div className="flex min-w-0 shrink-0 items-center gap-2 leading-none">{badge}</div>
        ) : null}
        {subtitle ? (
          <div className="flex min-w-0 items-center gap-1.5 leading-none">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex h-full shrink-0 items-stretch">{actions}</div> : null}
    </header>
  );
}
