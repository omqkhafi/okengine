/**
 * Copy-to-clipboard control used in inspector subtitles.
 */

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type JSX } from "react";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import { EXPLORER_ICON_BUTTON_BARE_CLASS } from "./explorer-chrome.ts";

/** Props for {@link CopyInlineButton}. */
export interface CopyInlineButtonProps {
  readonly value: string;
  readonly label: string;
}

/**
 * Ghost icon button that copies `value` and flashes a tick.
 *
 * @param props - Clipboard payload + accessible label
 */
export function CopyInlineButton({ value, label }: CopyInlineButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToolbarTip label={copied ? "Copied" : label}>
      <button
        type="button"
        aria-label={label}
        className={cn(EXPLORER_ICON_BUTTON_BARE_CLASS, "size-4")}
        onClick={() => {
          if (!navigator.clipboard) return;
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          className={copied ? "size-3 text-emerald-600 dark:text-emerald-400" : "size-3"}
          aria-hidden
        />
      </button>
    </ToolbarTip>
  );
}
