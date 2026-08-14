/**
 * Once-shown new master key — acknowledge to dismiss.
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

/** Props for {@link VaultMasterKeySheet}. */
export interface VaultMasterKeySheetProps {
  readonly masterKey: string | null;
  readonly onDismiss: () => void;
}

/**
 * Shows the generated master key once. Copy warns; dismiss is acknowledge.
 *
 * @param props - Key + dismiss
 */
export function VaultMasterKeySheet({
  masterKey,
  onDismiss,
}: VaultMasterKeySheetProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const open = masterKey !== null;

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
        data-slot="vault-master-key-sheet"
      >
        <SheetHeader>
          <SheetTitle>New master key</SheetTitle>
          <SheetDescription>
            Shown once. Store it offline. This Console process does not keep it for you.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <p className="border-b border-border/50 px-4 py-3 font-mono text-[11px] break-all">
            {masterKey}
          </p>
          <p className="px-4 py-3 text-[11px] text-muted-foreground" role="status">
            Copying puts the key on the clipboard. Anyone with this device can read it until you
            clear it.
          </p>
        </div>
        <SheetFooter>
          <SheetFooterButton
            split
            disabled={!masterKey}
            onClick={() => {
              if (!masterKey) return;
              void navigator.clipboard?.writeText(masterKey);
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
