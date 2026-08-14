/**
 * Rotate-master ConfirmSheet — always typed ROTATE_MASTER.
 */

import type { JSX } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet.tsx";

/** Props for {@link VaultRotateMasterSheet}. */
export interface VaultRotateMasterSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm: (input: { readonly confirmation: string; readonly reason: string }) => void;
}

/**
 * Master-key rotation confirm. Both KEKs stay live until remaining is 0.
 *
 * @param props - Sheet state + confirm
 */
export function VaultRotateMasterSheet({
  open,
  onOpenChange,
  pending = false,
  error,
  onConfirm,
}: VaultRotateMasterSheetProps): JSX.Element {
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      phrase="ROTATE_MASTER"
      title="Rotate master key"
      description="Generates a new master key and rewraps DEKs in batches. Both keys stay live until remaining is 0. The new key is shown once."
      pending={pending}
      error={error}
      confirmLabel="Confirm rotate master"
      slot="vault-rotate-master-sheet"
      onConfirm={onConfirm}
    />
  );
}
