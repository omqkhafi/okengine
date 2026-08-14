/**
 * Inspector identity header — Store / Vault / Units share one chrome.
 */

import type { CSSProperties, JSX, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import { DETAIL_HEADER_CLASS, DETAIL_TITLE_CLASS, DETAIL_WELL_CLASS } from "./explorer-chrome.ts";

/** Props for {@link DetailHeader}. */
export interface DetailHeaderProps {
  readonly icon: ReactNode;
  readonly wellClassName?: string;
  readonly wellStyle?: CSSProperties;
  readonly title: ReactNode;
  readonly badge?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly sticky?: boolean;
  readonly className?: string;
  readonly dataSlot?: string;
}

/**
 * Compact identity row: tinted well, title, optional badge / subtitle / actions.
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
      <span className={cn(DETAIL_WELL_CLASS, wellClassName)} style={wellStyle} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className={DETAIL_TITLE_CLASS}>{title}</h2>
          {badge}
        </div>
        {subtitle}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
