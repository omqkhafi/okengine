"use client";

/**
 * Resizable split panels — shadcn-style wrapper over `react-resizable-panels` v4
 * (`Group` / `Panel` / `Separator`).
 */

import { GripVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
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
        "relative flex items-center justify-center bg-border",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        // Group orientation="horizontal" → aria-orientation="vertical" (tree | detail).
        "aria-[orientation=vertical]:w-px",
        "aria-[orientation=vertical]:after:absolute aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-1 aria-[orientation=vertical]:after:-translate-x-1/2",
        // Group orientation="vertical" → aria-orientation="horizontal" (editor / results).
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:after:absolute aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "aria-[orientation=horizontal]:[&>div]:rotate-90",
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

/** Imperative handle for a {@link ResizablePanel} (collapse / expand). */
export { usePanelRef };

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
