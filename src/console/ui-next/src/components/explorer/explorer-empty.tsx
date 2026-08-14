/**
 * Centered empty / loading pane for explorer inspectors.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX, ReactNode } from "react";
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
}: ExplorerEmptyProps): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
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
  );
}
