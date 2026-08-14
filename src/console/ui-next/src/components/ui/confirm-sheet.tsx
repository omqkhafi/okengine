/**
 * Typed-confirmation Sheet for irreversible Console writes.
 */

import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetError,
  SheetField,
  SheetFooterButton,
} from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { validateTypedConfirm } from "@/features/store/lib/confirmation.ts";
import { cn } from "@/lib/utils.ts";

/** Props for {@link ConfirmSheet}. */
export interface ConfirmSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Phrase the operator must type. */
  readonly phrase: string;
  readonly title: string;
  readonly description: string;
  /** Extra fields above the phrase / reason (password, warnings). */
  readonly children?: ReactNode;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly confirmLabel?: string;
  readonly confirmVariant?: "destructive" | "ghost";
  /** `data-slot` on the sheet content. */
  readonly slot?: string;
  readonly onConfirm: (input: { readonly confirmation: string; readonly reason: string }) => void;
}

/**
 * Right Sheet that requires an exact typed phrase + reason before enabling
 * the destructive action.
 *
 * @param props - Sheet state + confirm callback
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  phrase,
  title,
  description,
  children,
  pending = false,
  error,
  confirmLabel,
  confirmVariant = "destructive",
  slot = "confirm-sheet",
  onConfirm,
}: ConfirmSheetProps): JSX.Element {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setReason("");
      setTouched(false);
    }
  }, [open]);

  const errors = touched ? validateTypedConfirm({ typed, reason, phrase }) : null;
  const valid = validateTypedConfirm({ typed, reason, phrase }) === null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showOverlay={false} className="sm:max-w-md" data-slot={slot}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}

          <SheetField label={`Type ${phrase} to confirm`}>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={phrase}
              aria-label={`Type ${phrase} to confirm`}
              aria-invalid={errors?.typed ? true : undefined}
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
              autoComplete="off"
            />
            {errors?.typed ? (
              <span className="block px-4 pb-2 text-[10px] text-destructive" role="alert">
                {errors.typed}
              </span>
            ) : null}
          </SheetField>

          <SheetField label="Reason">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Why is this change needed?"
              aria-label="Reason"
              aria-invalid={errors?.reason ? true : undefined}
              flat
              className={SHEET_CONTROL}
            />
            {errors?.reason ? (
              <span className="block px-4 pb-2 text-[10px] text-destructive" role="alert">
                {errors.reason}
              </span>
            ) : null}
          </SheetField>

          {error ? <SheetError>{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant={confirmVariant}
            disabled={!valid || pending}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onConfirm({ confirmation: typed.trim(), reason: reason.trim() });
            }}
            data-slot="confirm-action"
          >
            {pending ? "Working…" : (confirmLabel ?? `Confirm ${phrase.toLowerCase()}`)}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
