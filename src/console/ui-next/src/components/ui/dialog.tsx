/**
 * Centered dialog — Base UI Dialog, Console-flat.
 */

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps, JSX } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Controlled dialog root.
 *
 * @param props - Base UI root props
 */
function Dialog({ ...props }: DialogPrimitive.Root.Props): JSX.Element {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/**
 * Portal for the dialog.
 *
 * @param props - Portal props
 */
function DialogPortal({ ...props }: DialogPrimitive.Portal.Props): JSX.Element {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/**
 * Dimmed backdrop. Click dismisses the dialog.
 *
 * @param props - Backdrop props
 */
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props): JSX.Element {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Centered popup.
 *
 * @param props - Popup props
 */
function DialogContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props): JSX.Element {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-none border border-border bg-popover text-sm text-popover-foreground shadow-lg outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

/**
 * Title + description block.
 *
 * @param props - Header props
 */
function DialogHeader({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 border-b border-border/60 px-4 py-3", className)}
      {...props}
    />
  );
}

/**
 * Action row.
 *
 * @param props - Footer props
 */
function DialogFooter({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-row items-stretch border-t border-border/60 p-0", className)}
      {...props}
    />
  );
}

/**
 * Accessible title.
 *
 * @param props - Title props
 */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props): JSX.Element {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

/**
 * Accessible description.
 *
 * @param props - Description props
 */
function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): JSX.Element {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[11px] text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
};
