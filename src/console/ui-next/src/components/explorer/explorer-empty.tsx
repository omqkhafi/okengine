/**
 * Centered empty / loading pane for explorer inspectors.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX, ReactNode } from "react";
import { DETAIL_HEADER_CLASS } from "./explorer-chrome.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";

/** Props for {@link ExplorerEmpty}. */
export interface ExplorerEmptyProps {
  readonly icon?: ElementHugeIcon;
  readonly iconClassName?: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** First control on an identity strip (start-panel toggle). */
  readonly leading?: ReactNode;
}

/**
 * Full-pane empty state — same Empty primitive as Traces and Vault.
 *
 * @param props - Icon + copy
 */
export function ExplorerEmpty({
  icon,
  iconClassName,
  title,
  description,
  children,
  leading,
}: ExplorerEmptyProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {leading ? (
        <header className={DETAIL_HEADER_CLASS}>
          <div className="-ml-2 flex h-full shrink-0 items-stretch">
            {leading}
            <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
          </div>
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Empty className="border-0">
          <EmptyHeader>
            {icon ? (
              <EmptyMedia variant="icon" className={iconClassName}>
                <HugeiconsIcon icon={icon} />
              </EmptyMedia>
            ) : null}
            <EmptyTitle>{title}</EmptyTitle>
            {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          </EmptyHeader>
          {children}
        </Empty>
      </div>
    </div>
  );
}
