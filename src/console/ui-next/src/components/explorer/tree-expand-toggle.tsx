/**
 * Unfold control for explorer trees (search bar or a band / folder row).
 */

import { UnfoldLessIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import { EXPLORER_ICON_BUTTON_BARE_CLASS, EXPLORER_ICON_BUTTON_CLASS } from "./explorer-chrome.ts";

/** Props for {@link TreeExpandToggle}. */
export interface TreeExpandToggleProps {
  readonly allOpen: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
  readonly collapseLabel?: string;
  readonly expandLabel?: string;
  readonly dataSlot: string;
  readonly className?: string;
  /** When true, the button discloses one section (`aria-expanded`). */
  readonly disclose?: boolean;
  /** Icon-only — no chrome. Used on band / folder rows. */
  readonly bare?: boolean;
}

/**
 * Expand / collapse all nodes in a tree, band, or folder.
 *
 * @param props - Open state + toggle + placement
 */
export function TreeExpandToggle({
  allOpen,
  disabled,
  onToggle,
  collapseLabel = "Collapse all",
  expandLabel = "Expand all",
  dataSlot,
  className,
  disclose = false,
  bare = false,
}: TreeExpandToggleProps): JSX.Element {
  const label = allOpen ? collapseLabel : expandLabel;
  return (
    <ToolbarTip label={label} className={bare ? undefined : "flex self-stretch"}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={disclose ? allOpen : undefined}
        data-slot={dataSlot}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={cn(
          bare ? EXPLORER_ICON_BUTTON_BARE_CLASS : EXPLORER_ICON_BUTTON_CLASS,
          className,
        )}
      >
        <HugeiconsIcon
          icon={allOpen ? UnfoldLessIcon : UnfoldMoreIcon}
          className="size-3.5"
          aria-hidden
        />
      </button>
    </ToolbarTip>
  );
}
