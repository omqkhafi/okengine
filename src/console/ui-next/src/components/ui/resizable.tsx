"use client";

/**
 * Resizable split panels — shadcn-style wrapper over `react-resizable-panels` v4
 * (`Group` / `Panel` / `Separator`).
 */

import { GripVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Panel group container.
 *
 * @param props - Group props (orientation, layout callbacks)
 */
function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return (
    <Group
      className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

/**
 * A single resizable panel.
 */
const ResizablePanel = Panel;

/**
 * Drag handle between two panels.
 *
 * @param props - Separator props plus `withHandle` to show a grip
 */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ComponentProps<typeof Separator> & {
  readonly withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-border",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        "data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full",
        "data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0",
        "[&[data-orientation=vertical]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <HugeiconsIcon icon={GripVerticalIcon} className="size-2.5" />
        </div>
      ) : null}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
