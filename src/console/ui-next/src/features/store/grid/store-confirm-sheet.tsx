/**
 * Typed-confirmation Sheet for irreversible Store mutations (EDIT / DELETE).
 */

import { useEffect, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

        <div className="flex flex-col gap-3 px-4">
          {willNotFire && (willNotFire.signals.length > 0 || willNotFire.channels.length > 0) ? (
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
          ) : null}

          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to
              confirm
            </span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={phrase}
              aria-label={`Type ${phrase} to confirm`}
              aria-invalid={errors?.typed ? true : undefined}
              className="h-8 font-mono text-[11px]"
              autoComplete="off"
            />
            {errors?.typed ? (
              <span className="text-[10px] text-destructive" role="alert">
                {errors.typed}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground">Reason (min 3 characters)</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Why is this change needed?"
              aria-label="Reason"
              aria-invalid={errors?.reason ? true : undefined}
              className="h-8 text-[11px]"
            />
            {errors?.reason ? (
              <span className="text-[10px] text-destructive" role="alert">
                {errors.reason}
              </span>
            ) : null}
          </label>

          {error ? (
            <p className="text-[11px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
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
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
