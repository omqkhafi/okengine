/**
 * Uppercase section eyebrow — contract panels, vault inspector, traces sheet.
 */

import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";
import { SECTION_HEAD_CLASS } from "./explorer-chrome.ts";

/** Props for {@link SectionHead}. */
export interface SectionHeadProps {
  readonly title: string;
  readonly meta?: string;
  readonly ruled?: boolean;
}

/**
 * Section label with optional mono meta and a hairline rule.
 *
 * @param props - Title + optional meta
 */
export function SectionHead({ title, meta, ruled = true }: SectionHeadProps): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2",
        ruled && "border-b border-border/50 pb-1.5",
      )}
    >
      <h3 className={SECTION_HEAD_CLASS}>{title}</h3>
      {meta ? <span className="font-mono text-[10px] text-muted-foreground">{meta}</span> : null}
    </div>
  );
}
