/**
 * Audit-chain break explain Sheet.
 */

import type { JSX } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import type { VaultAuditVerifyResult } from "../lib/types.ts";

/** Props for {@link VaultVerifySheet}. */
export interface VaultVerifySheetProps {
  readonly result: VaultAuditVerifyResult | null;
  readonly onClose: () => void;
}

/**
 * Plain-language explain for a broken audit chain.
 *
 * @param props - Verify payload
 */
export function VaultVerifySheet({ result, onClose }: VaultVerifySheetProps): JSX.Element {
  const open = result !== null && result.ok === false;
  const reasonCopy =
    result?.reason === "link"
      ? "prev-hash does not match the previous row"
      : result?.reason === "payload"
        ? "stored row hash does not match the payload"
        : "the chain failed verification";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="vault-verify-sheet"
      >
        <SheetHeader>
          <SheetTitle>Chain broken</SheetTitle>
          <SheetDescription>
            The audit hash chain failed at{" "}
            <span className="font-mono">{result?.brokenAt ?? "unknown"}</span>.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-[11px]">
          <p className="border-b border-border/50 px-4 py-3" role="alert">
            Reason: {reasonCopy}.
          </p>
          {result?.row ? (
            <dl className="divide-y divide-border/50">
              <VerifyFact label="id" value={result.row.id} mono />
              <VerifyFact label="seq" value={String(result.row.seq)} mono />
              <VerifyFact label="action" value={result.row.action} />
              <VerifyFact label="path" value={result.row.path ?? "—"} mono />
              <VerifyFact
                label="actor"
                value={`${result.row.actorType} ${result.row.actorId ?? ""}`}
              />
              <VerifyFact label="time" value={new Date(result.row.createdAt).toISOString()} mono />
              {result.row.errorMessage ? (
                <VerifyFact label="error" value={result.row.errorMessage} />
              ) : null}
            </dl>
          ) : null}
        </div>
        <SheetFooter>
          <SheetFooterButton onClick={onClose}>Close</SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function VerifyFact({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <div className="px-4 py-2.5">
      <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-[11px] break-all" : "text-[11px]"}>{value}</dd>
    </div>
  );
}
