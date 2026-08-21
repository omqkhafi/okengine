/**
 * Reveal-once API key secret — same acknowledge pattern as Vault master key.
 */

import { useState, type JSX } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SheetFooterButton } from "@/components/ui/sheet-form.tsx";

/** Props for {@link AccessSecretSheet}. */
export interface AccessSecretSheetProps {
  readonly secret: string | null;
  readonly title?: string;
  readonly onDismiss: () => void;
}

/**
 * Shows the generated key secret once. Copy warns; dismiss is acknowledge.
 *
 * @param props - Secret + dismiss
 */
export function AccessSecretSheet({
  secret,
  title = "New API key",
  onDismiss,
}: AccessSecretSheetProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const open = secret !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="access-secret-sheet"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Shown once. Store it offline. This Console process does not keep it for you.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <p className="border-b border-border/50 px-4 py-3 font-mono text-[11px] break-all">
            {secret}
          </p>
          <p className="px-4 py-3 text-[11px] text-muted-foreground" role="status">
            Copying puts the secret on the clipboard. Anyone with this device can read it until you
            clear it.
          </p>
        </div>
        <SheetFooter>
          <SheetFooterButton
            split
            disabled={!secret}
            onClick={() => {
              if (!secret) return;
              void navigator.clipboard?.writeText(secret);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy (clipboard warning)"}
          </SheetFooterButton>
          <SheetFooterButton
            variant="destructive"
            onClick={() => {
              setCopied(false);
              onDismiss();
            }}
          >
            I have stored this key
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
