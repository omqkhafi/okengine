/**
 * Pause before a vault write — name, fingerprint, reason. No typed phrase.
 */

import type { JSX } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import type { VaultWriteReview } from "../lib/write-review.ts";

/** Props for {@link VaultWriteReviewDialog}. */
export interface VaultWriteReviewDialogProps {
  readonly review: VaultWriteReview | null;
  readonly pending?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

const TITLES = {
  create: "Confirm add",
  set: "Confirm set",
  rotate: "Confirm rotate",
} as const;

const CONFIRMS = {
  create: "Add contract",
  set: "Set value",
  rotate: "Rotate",
} as const;

/**
 * Review dialog for create / set / rotate.
 *
 * @param props - Open review + confirm/cancel
 */
export function VaultWriteReviewDialog({
  review,
  pending = false,
  onCancel,
  onConfirm,
}: VaultWriteReviewDialogProps): JSX.Element {
  return (
    <AlertDialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialogContent data-slot="vault-write-review">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {review ? `${TITLES[review.action]} ${review.name}` : "Confirm write"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {review?.preview != null
              ? "Config is shown in the clear after submit."
              : "Write-only. The value is never shown again."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {review ? <VaultWriteReviewFacts review={review} /> : null}
        <AlertDialogFooter>
          <SheetFooterButton
            split
            onClick={onCancel}
            disabled={pending}
            data-slot="vault-write-review-cancel"
          >
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant={review?.action === "rotate" ? "destructive" : "default"}
            disabled={pending || review === null}
            onClick={onConfirm}
            data-slot="vault-write-review-confirm"
          >
            {pending ? "Working…" : review ? CONFIRMS[review.action] : "Confirm"}
          </SheetFooterButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Facts the operator must see before Confirm. Secrets never include cleartext.
 *
 * @param props - Open review
 */
export function VaultWriteReviewFacts({
  review,
}: {
  readonly review: VaultWriteReview;
}): JSX.Element {
  return (
    <dl className="flex flex-col" data-slot="vault-write-review-facts">
      <ReviewFact label="Name" value={review.name} mono />
      {review.action === "create" ? <ReviewFact label="Kind" value={review.kind} /> : null}
      <ReviewFact label="Fingerprint" value={review.fingerprint} mono />
      {review.preview != null ? <ReviewFact label="Value" value={review.preview} mono /> : null}
      {review.reason ? <ReviewFact label="Reason" value={review.reason} /> : null}
      {review.action === "create" && review.rotate ? (
        <ReviewFact label="Rotate" value={review.rotate} />
      ) : null}
    </dl>
  );
}

function ReviewFact({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 px-4 py-2 last:border-b-0">
      <dt className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-[11px]" : "min-w-0 truncate text-[12px]"}>
        {value}
      </dd>
    </div>
  );
}
