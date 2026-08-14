/**
 * Hover hint for Console toolbar controls.
 */

import type { JSX, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils.ts";

/** Props for {@link ToolbarTip}. */
export interface ToolbarTipProps {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Tooltip around a toolbar control. Uses a span so it works on disabled
 * buttons and dropdown triggers without merging their event handlers.
 *
 * @param props - Hint copy + control
 */
export function ToolbarTip({ label, className, children }: ToolbarTipProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span {...props} className={cn("inline-flex items-center", className)} tabIndex={-1}>
            {children}
          </span>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
