/**
 * Collapse / expand the start-side explorer on a split page.
 */

import type { JSX } from "react";
import { LayoutAlignLeftIcon, LayoutAlignRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { EXPLORER_ICON_BUTTON_CLASS } from "./explorer-chrome.ts";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";

/** Props for {@link ExplorerStartToggle}. */
export interface ExplorerStartToggleProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Spoken noun — `Collapse {noun}` / `Expand {noun}`. */
  readonly noun: string;
  readonly controlsId: string;
  readonly dataSlot: string;
}

/**
 * Flush-left layout-align control for a start explorer panel.
 *
 * @param props - Open state + spoken noun
 */
export function ExplorerStartToggle({
  open,
  onToggle,
  noun,
  controlsId,
  dataSlot,
}: ExplorerStartToggleProps): JSX.Element {
  const label = open ? `Collapse ${noun}` : `Expand ${noun}`;
  return (
    <ToolbarTip label={label} className="flex self-stretch">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controlsId}
        aria-label={label}
        data-slot={dataSlot}
        onClick={onToggle}
        className={EXPLORER_ICON_BUTTON_CLASS}
      >
        <HugeiconsIcon
          icon={open ? LayoutAlignLeftIcon : LayoutAlignRightIcon}
          className="size-3.5"
        />
      </button>
    </ToolbarTip>
  );
}
