/**
 * Centered confirm dialog — Base UI AlertDialog, Console-flat.
 */

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ComponentProps, JSX } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Controlled alert dialog root.
 *
 * @param props - Base UI root props
 */
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props): JSX.Element {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

/**
 * Portal for the alert dialog.
 *
 * @param props - Portal props
 */
function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props): JSX.Element {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

/**
 * Dimmed backdrop. Pointer dismissal is disabled by AlertDialog.
 *
 * @param props - Backdrop props
 */
function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props): JSX.Element {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
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
function AlertDialogContent({
  className,
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props): JSX.Element {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-none border border-border bg-popover text-sm text-popover-foreground shadow-lg outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  );
}

/**
 * Title + description block.
 *
 * @param props - Header props
 */
function AlertDialogHeader({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1 border-b border-border/50 px-4 py-3", className)}
      {...props}
    />
  );
}

/**
 * Confirm / cancel row.
 *
 * @param props - Footer props
 */
function AlertDialogFooter({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-row items-stretch border-t border-border/50 p-0", className)}
      {...props}
    />
  );
}

/**
 * Accessible title.
 *
 * @param props - Title props
 */
function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props): JSX.Element {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
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
function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props): JSX.Element {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-[11px] text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
};
