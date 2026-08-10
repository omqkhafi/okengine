/**
 * Honest empty state for shell sections that are not built yet.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

/**
 * Empty composition for a named Console section.
 *
 * @param props - Section label and icon
 */
export function SectionEmpty({
  title,
  description,
  icon,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: HugeIcon;
}) {
  return (
    <Empty className="min-h-[50vh] border border-dashed" data-slot="section-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
