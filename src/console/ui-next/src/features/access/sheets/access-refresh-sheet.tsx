/**
 * Refresh an Access key expiry — same secret, new deadline from now.
 */

import { useEffect, useState, type JSX } from "react";
import type { AccessKeyRow } from "@/client.ts";
import { SheetError, SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  accessExpiresAt,
  accessRefreshExpiry,
  parseAccessDurationMs,
  type AccessExpiryChoice,
} from "../lib/format-when.ts";
import { AccessExpiryFields } from "./access-expiry-fields.tsx";

/** Props for {@link AccessRefreshSheet}. */
export interface AccessRefreshSheetProps {
  readonly open: boolean;
  readonly keyRow: AccessKeyRow;
  readonly pending: boolean;
  readonly error: string | null;
  readonly now?: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (expiresAt: number | null) => void;
}

/**
 * Expiry-only sheet. Does not mint or reveal a secret.
 *
 * @param props - Open + key + submit
 */
export function AccessRefreshSheet({
  open,
  keyRow,
  pending,
  error,
  now = Date.now(),
  onOpenChange,
  onSubmit,
}: AccessRefreshSheetProps): JSX.Element {
  const seeded = accessRefreshExpiry(keyRow.expiresAt, now);
  const [expires, setExpires] = useState<AccessExpiryChoice>(seeded.choice);
  const [customExpires, setCustomExpires] = useState(seeded.custom);

  useEffect(() => {
    if (!open) return;
    const next = accessRefreshExpiry(keyRow.expiresAt, now);
    setExpires(next.choice);
    setCustomExpires(next.custom);
  }, [open, keyRow.id]);

  const customMs = parseAccessDurationMs(customExpires);
  const ready = !pending && (expires !== "custom" || customMs > 0);

  return (
    <Sheet open={open} modal={false} disablePointerDismissal onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="access-refresh-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Refresh expiry</SheetTitle>
          <SheetDescription className="text-[11px]">
            Reset the deadline from now. The secret does not change.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <AccessExpiryFields
            expires={expires}
            customExpires={customExpires}
            onExpires={setExpires}
            onCustomExpires={setCustomExpires}
          />
          {error ? <SheetError slot="access-refresh-error">{error}</SheetError> : null}
        </div>
        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={!ready}
            data-slot="access-refresh-submit"
            onClick={() => {
              onSubmit(accessExpiresAt(expires, Date.now(), customExpires));
            }}
          >
            {pending ? "Refreshing…" : "Refresh"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
