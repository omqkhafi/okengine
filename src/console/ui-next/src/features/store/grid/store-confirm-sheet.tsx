/**
 * Typed-confirmation Sheet for irreversible Store mutations (EDIT / DELETE).
 */

import { useEffect, useState, type JSX } from "react";
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
import { cn } from "@/lib/utils.ts";
import { validateTypedConfirm } from "../lib/confirmation.ts";

/** Props for {@link StoreConfirmSheet}. */
export interface StoreConfirmSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Phrase the operator must type (`EDIT` / `DELETE`). */
  readonly phrase: string;
  readonly title: string;
  readonly description: string;
  /** Summary of what will not fire (signals/channels) for edits. */
  readonly willNotFire?: {
    readonly signals: readonly string[];
    readonly channels: readonly string[];
  } | null;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm: (input: { readonly confirmation: string; readonly reason: string }) => void;
}

/**
 * Modal-style Sheet that requires an exact typed phrase + reason before enabling
 * the destructive action.
 *
 * @param props - Sheet state + confirm callback
 */
export function StoreConfirmSheet({
  open,
  onOpenChange,
  phrase,
  title,
  description,
  willNotFire,
  pending = false,
  error,
  onConfirm,
}: StoreConfirmSheetProps): JSX.Element {
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
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="store-confirm-sheet"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {willNotFire && (willNotFire.signals.length > 0 || willNotFire.channels.length > 0) ? (
            <div className="px-4 py-3">
              <div
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300"
                role="status"
                data-slot="will-not-fire"
              >
                <p className="font-medium">This direct edit will not fire:</p>
                {willNotFire.signals.length > 0 ? (
                  <p>signals: {willNotFire.signals.join(", ")}</p>
                ) : null}
                {willNotFire.channels.length > 0 ? (
                  <p>channels: {willNotFire.channels.join(", ")}</p>
                ) : null}
              </div>
            </div>
          ) : null}

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
            variant="destructive"
            disabled={!valid || pending}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onConfirm({ confirmation: typed.trim(), reason: reason.trim() });
            }}
            data-slot="confirm-action"
          >
            {pending ? "Working…" : `Confirm ${phrase.toLowerCase()}`}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
