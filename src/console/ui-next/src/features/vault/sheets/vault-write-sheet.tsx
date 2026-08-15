/**
 * Set / rotate a vault value — reason chips, then a review dialog.
 */

import { useEffect, useState, type JSX } from "react";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetChoice,
  SheetChoiceRow,
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
import {
  cancelVaultWrite,
  confirmVaultWrite,
  openVaultWriteReview,
  type VaultWriteReview,
} from "../lib/write-review.ts";
import { VaultWriteReviewDialog } from "./vault-write-review-dialog.tsx";

type ReasonId = "scheduled" | "leak" | "provider" | "first" | "fix" | "other";

interface ReasonChoice {
  readonly id: ReasonId;
  readonly label: string;
  readonly text: string;
}

const SET_REASONS: readonly ReasonChoice[] = [
  { id: "first", label: "first", text: "Initial value" },
  { id: "fix", label: "fix", text: "Correct a bad value" },
  { id: "provider", label: "provider", text: "Provider changed it" },
  { id: "other", label: "other", text: "" },
];

const ROTATE_REASONS: readonly ReasonChoice[] = [
  { id: "scheduled", label: "scheduled", text: "Scheduled rotation" },
  { id: "leak", label: "leak", text: "Key compromise" },
  { id: "provider", label: "provider", text: "Provider rotated" },
  { id: "other", label: "other", text: "" },
];

function reasonsFor(mode: "set" | "rotate"): readonly ReasonChoice[] {
  return mode === "rotate" ? ROTATE_REASONS : SET_REASONS;
}

function defaultReasonId(mode: "set" | "rotate"): ReasonId {
  return mode === "rotate" ? "scheduled" : "first";
}

function resolveReason(mode: "set" | "rotate", id: ReasonId, custom: string): string {
  if (id === "other") return custom.trim();
  return reasonsFor(mode).find((item) => item.id === id)?.text ?? "";
}

/** Props for {@link VaultWriteSheet}. */
export interface VaultWriteSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "set" | "rotate";
  readonly name: string;
  /** When false, Console will show the new value in the Config band. */
  readonly sensitive?: boolean;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onSubmit: (input: { readonly value: string; readonly reason: string }) => void;
}

/**
 * Set / rotate sheet. Secrets stay write-only; config values reappear
 * in the Config band after submit.
 *
 * @param props - Mode + submit
 */
export function VaultWriteSheet({
  open,
  onOpenChange,
  mode,
  name,
  sensitive = true,
  pending = false,
  error,
  onSubmit,
}: VaultWriteSheetProps): JSX.Element {
  const [value, setValue] = useState("");
  const [reasonId, setReasonId] = useState<ReasonId>(() => defaultReasonId(mode));
  const [customReason, setCustomReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [review, setReview] = useState<VaultWriteReview | null>(null);

  useEffect(() => {
    if (!open) {
      setValue("");
      setReasonId(defaultReasonId(mode));
      setCustomReason("");
      setLocalError(null);
      setReview(null);
    }
  }, [open, mode]);

  const reason = resolveReason(mode, reasonId, customReason);
  const ready = value.trim().length > 0 && reason.length >= 3 && !pending;
  const choices = reasonsFor(mode);

  const requestReview = async (): Promise<void> => {
    const next = await openVaultWriteReview({
      action: mode,
      name,
      value,
      sensitive,
      reason,
      kind: sensitive ? "secret" : "config",
    });
    if ("error" in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setReview(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="vault-write-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">
            {mode === "set" ? `Set ${name}` : `Rotate ${name}`}
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            {sensitive
              ? "Write-only. The new value is never shown again after submit."
              : "This vault.config value is shown in the clear on the Config band after submit."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SheetField label="New value">
            <Input
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={sensitive ? "Paste the new secret" : "Paste the new value"}
              aria-label="New vault value"
              flat
              className={SHEET_CONTROL}
            />
          </SheetField>
          <SheetChoiceRow label="Reason">
            {choices.map((item) => (
              <SheetChoice
                key={item.id}
                active={reasonId === item.id}
                onClick={() => setReasonId(item.id)}
              >
                {item.label}
              </SheetChoice>
            ))}
          </SheetChoiceRow>
          {reasonId === "other" ? (
            <SheetField label="Other">
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Why is this change needed?"
                aria-label="Custom reason"
                flat
                className={SHEET_CONTROL}
              />
            </SheetField>
          ) : null}
          {localError || error ? (
            <SheetError slot="vault-write-error">{localError ?? error}</SheetError>
          ) : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant={mode === "rotate" ? "destructive" : "default"}
            disabled={!ready}
            onClick={() => {
              void requestReview();
            }}
            data-slot="vault-write-submit"
          >
            {mode === "set" ? "Review set" : "Review rotate"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>

      <VaultWriteReviewDialog
        review={review}
        pending={pending}
        onCancel={() => setReview(cancelVaultWrite())}
        onConfirm={() => {
          confirmVaultWrite(review, (next) => {
            onSubmit({
              value: next.commit.value,
              reason: next.commit.reason ?? reason,
            });
          });
        }}
      />
    </Sheet>
  );
}
