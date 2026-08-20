/**
 * Keyboard key — shadcn Kbd. Buttons inherit ink; tooltips invert.
 */

import type { ComponentProps, JSX } from "react";
import { cn } from "@/lib/utils";

/**
 * One key cap.
 *
 * @param props - Native `kbd` props
 */
function Kbd({ className, ...props }: ComponentProps<"kbd">): JSX.Element {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-none bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-[.bg-primary]:bg-primary-foreground/20 in-[.bg-primary]:text-primary-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Group of key caps (⌘ K, G O).
 *
 * @param props - Wrapper props
 */
function KbdGroup({ className, ...props }: ComponentProps<"kbd">): JSX.Element {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
