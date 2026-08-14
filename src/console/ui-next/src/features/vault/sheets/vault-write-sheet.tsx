/**
 * Set / rotate ConfirmSheet — password value + typed phrase.
 */

import { useEffect, useState, type JSX } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet.tsx";
import { Input } from "@/components/ui/input";
import { SHEET_CONTROL, SheetField } from "@/components/ui/sheet-form.tsx";

/** Props for {@link VaultWriteSheet}. */
export interface VaultWriteSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "set" | "rotate";
  readonly name: string;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm: (input: {
    readonly value: string;
    readonly confirmation: string;
    readonly reason: string;
  }) => void;
}

/**
 * Write-only set / rotate sheet. No preview.
 *
 * @param props - Mode + confirm
 */
export function VaultWriteSheet({
  open,
  onOpenChange,
  mode,
  name,
  pending = false,
  error,
  onConfirm,
}: VaultWriteSheetProps): JSX.Element {
  const [value, setValue] = useState("");
  const phrase = mode === "set" ? "SET" : "ROTATE";

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      phrase={phrase}
      title={mode === "set" ? `Set ${name}` : `Rotate ${name}`}
      description="Write-only. The new value is never shown again after submit."
      pending={pending}
      error={error}
      confirmLabel={mode === "set" ? "Confirm set" : "Confirm rotate"}
      slot="vault-write-sheet"
      onConfirm={({ confirmation, reason }) => {
        onConfirm({ value, confirmation, reason });
      }}
    >
      <SheetField label="New value">
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="New vault value"
          flat
          className={SHEET_CONTROL}
        />
      </SheetField>
    </ConfirmSheet>
  );
}
