/**
 * Theme toggle — light / dark / system as strip tokens.
 * Active token is ink only; idle tokens are icon-only + tooltip.
 */

import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme, type Theme } from "@/components/theme-provider";
import {
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const options: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun03Icon;
}> = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon },
];

/**
 * Segmented control that sets the Console theme preference.
 * Active segment is ink on the strip — no pill, no muted well.
 *
 * @returns Theme toggle group for Console chrome
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      data-slot="mode-toggle"
      className="flex h-10 items-stretch"
    >
      {options.map((option) => {
        const active = theme === option.value;
        return (
          <Tooltip key={option.value} disabled={active}>
            <TooltipTrigger
              render={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={active}
                  onClick={(event) => {
                    props.onClick?.(event);
                    setTheme(option.value);
                  }}
                  className={cn(
                    EXPLORER_STRIP_TOKEN_CLASS,
                    "font-semibold tracking-[0.08em] uppercase",
                    active ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                    props.className,
                  )}
                >
                  <HugeiconsIcon
                    icon={option.icon}
                    className="size-3"
                    color="currentColor"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  {active ? option.label : null}
                </button>
              )}
            />
            <TooltipContent side="top" sideOffset={6}>
              {option.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
