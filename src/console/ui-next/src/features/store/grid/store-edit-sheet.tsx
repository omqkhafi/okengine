/**
 * Edit row Sheet — preview → typed confirm → commit. PII-masked cells are
 * never prefilled with the mask; reveal first or set a new value.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
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
import { useStoreEdit, useStorePreview } from "../data/use-store-edit.ts";
import { useStoreReveal } from "../data/use-store-reveal.ts";
import { editConfirmation, validateTypedConfirm } from "../lib/confirmation.ts";
import { formatGridCell, type StoreGridModel, type StoreGridRow } from "../lib/grid-model.ts";
import { isStorePiiMask, parseStoreCellDraft, sanitizeStorePatch } from "../lib/patch.ts";

/** Props for {@link StoreEditSheet}. */
export interface StoreEditSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly model: StoreGridModel;
  readonly row: StoreGridRow | null;
  readonly facet: "sql" | "kv";
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly production: boolean;
}

/**
 * Edit one SQL row or KV value with dry-run preview and typed confirmation.
 *
 * @param props - Target row + facet + environment
 */
export function StoreEditSheet({
  open,
  onOpenChange,
  model,
  row,
  facet,
  storeRef,
  childName,
  tenant,
  production,
}: StoreEditSheetProps): JSX.Element {
  const preview = useStorePreview();
  const edit = useStoreEdit();
  const reveal = useStoreReveal();

  const editableColumns = useMemo(() => model.columns.filter((c) => c.editable), [model.columns]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, unknown>>({});
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const confirmation = editConfirmation({ production });
  const phrase = confirmation.kind === "typed" ? confirmation.phrase : "EDIT";

  useEffect(() => {
    if (!open || !row) {
      setDraft({});
      setRevealed({});
      setTyped("");
      setReason("");
      setTouched(false);
      preview.reset();
      edit.reset();
      return;
    }
    const next: Record<string, string> = {};
    for (const col of editableColumns) {
      const raw = row.cells[col.key];
      if (col.pii && isStorePiiMask(raw)) {
        next[col.key] = "";
      } else if (col.type === "integer" || col.type === "number") {
        next[col.key] = raw === null || raw === undefined ? "" : String(raw);
      } else if (col.type === "json") {
        next[col.key] = raw === undefined ? "" : JSON.stringify(raw, null, 2);
      } else {
        next[col.key] = raw === null || raw === undefined ? "" : String(raw);
      }
    }
    setDraft(next);
  }, [open, row, editableColumns, preview, edit]);

  if (!row) return <></>;

  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    for (const col of editableColumns) {
      const text = draft[col.key] ?? "";
      if (col.pii && text.trim() === "") continue;
      patch[col.key] = parseStoreCellDraft(col.type, text);
    }
    return sanitizeStorePatch(patch);
  };

  const baseInput = () => ({
    ref: storeRef,
    ...(facet === "sql" ? { child: childName, id: row.id } : { key: row.id }),
    ...(tenant ? { tenant } : {}),
  });

  const runPreview = () => {
    preview.mutate({ ...baseInput(), patch: buildPatch() });
  };

  const commit = () => {
    if (confirmation.kind === "typed") {
      const errors = validateTypedConfirm({ typed, reason, phrase });
      setTouched(true);
      if (errors) return;
    }
    edit.mutate(
      {
        ...baseInput(),
        patch: buildPatch(),
        commit: true,
        ...(confirmation.kind === "typed"
          ? { confirmation: typed.trim(), reason: reason.trim() }
          : {}),
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  const errors = touched ? validateTypedConfirm({ typed, reason, phrase }) : null;
  const confirmValid =
    confirmation.kind !== "typed" || validateTypedConfirm({ typed, reason, phrase }) === null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-lg"
        data-slot="store-edit-sheet"
      >
        <SheetHeader>
          <SheetTitle>
            Edit {facet === "sql" ? "row" : "key"} <span className="font-mono">{row.id}</span>
          </SheetTitle>
          <SheetDescription>
            Direct {facet === "sql" ? "SQL" : "KV"} edit — not a flow execution. Preview first;
            commit requires confirmation.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
          {editableColumns.map((col) => {
            const raw = row.cells[col.key];
            const masked = col.pii && isStorePiiMask(raw) && revealed[col.key] === undefined;
            return (
              <label key={col.key} className="flex flex-col gap-1 text-[11px]">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono">{col.key}</span>
                  {col.pii ? (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[9px] text-amber-800 dark:text-amber-300">
                      PII
                    </span>
                  ) : null}
                </span>
                {masked ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value=""
                      disabled
                      placeholder="[redacted] — reveal to edit current value"
                      aria-label={`${col.key} masked`}
                      className="h-8 font-mono text-[11px]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={reveal.isPending}
                      onClick={() => {
                        reveal.mutate(
                          {
                            ref: storeRef,
                            child: childName,
                            ...(tenant ? { tenant } : {}),
                            id: row.id,
                            column: col.key,
                          },
                          {
                            onSuccess: (data) => {
                              setRevealed((prev) => ({ ...prev, [col.key]: data.value }));
                              setDraft((prev) => ({
                                ...prev,
                                [col.key]: formatGridCell(data.value),
                              }));
                            },
                          },
                        );
                      }}
                    >
                      Reveal
                    </Button>
                  </div>
                ) : col.type === "json" ? (
                  <textarea
                    value={draft[col.key] ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [col.key]: e.target.value }))}
                    aria-label={col.key}
                    rows={4}
                    className="min-h-20 w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[11px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                ) : (
                  <Input
                    value={draft[col.key] ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [col.key]: e.target.value }))}
                    type={col.type === "integer" || col.type === "number" ? "number" : "text"}
                    aria-label={col.key}
                    className="h-8 font-mono text-[11px]"
                  />
                )}
                {col.pii && !masked ? (
                  <span className="text-[10px] text-muted-foreground">
                    Leave empty to keep the current value unchanged.
                  </span>
                ) : null}
              </label>
            );
          })}

          {preview.data ? (
            <div
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300"
              role="status"
              data-slot="edit-preview"
            >
              <p className="font-medium">Dry-run preview — will not fire:</p>
              <p>
                signals: {preview.data.willNotFire.signals.join(", ") || "none"} · channels:{" "}
                {preview.data.willNotFire.channels.join(", ") || "none"}
              </p>
            </div>
          ) : null}
          {preview.isError ? (
            <p className="text-[11px] text-destructive" role="alert">
              {preview.error.message}
            </p>
          ) : null}
          {edit.isError ? (
            <p className="text-[11px] text-destructive" role="alert">
              {edit.error.message}
            </p>
          ) : null}

          {confirmation.kind === "typed" ? (
            <>
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
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Non-production — commit applies immediately (undo window{" "}
              {confirmation.windowMs / 1000}
              s).
            </p>
          )}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={edit.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={runPreview}
            disabled={preview.isPending || edit.isPending}
            data-slot="preview-edit"
          >
            {preview.isPending ? "Previewing…" : "Preview"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={commit}
            disabled={!confirmValid || edit.isPending}
            data-slot="commit-edit"
          >
            {edit.isPending ? "Committing…" : "Commit edit"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
