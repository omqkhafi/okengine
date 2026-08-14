/**
 * Add a SQL row — column form, empty fields stay NULL.
 */

import { useEffect, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { Switch } from "@/components/motion/switch.tsx";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetError,
  SheetField,
  SheetFooterButton,
  SheetSwitchRow,
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
import { useStoreEdit } from "../data/use-store-edit.ts";
import type { StoreGridColumn } from "../lib/grid-model.ts";
import { buildInsertPatch, defaultInsertDraft, insertFormColumns } from "../lib/patch.ts";

/** Props for {@link SqlInsertSheet}. */
export interface SqlInsertSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly columns: readonly StoreGridColumn[];
}

/**
 * Right-side form to INSERT a row into the current SQL table.
 *
 * @param props - Store identity + column descriptors
 */
export function SqlInsertSheet({
  open,
  onOpenChange,
  storeRef,
  childName,
  tenant,
  columns,
}: SqlInsertSheetProps): JSX.Element {
  const { mutate, isPending, reset } = useStoreEdit();
  const fields = useMemo(() => insertFormColumns(columns), [columns]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [createMore, setCreateMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(defaultInsertDraft(fields));
    setError(null);
    reset();
  }, [open, fields, reset]);

  const setField = (key: string, value: string): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (): void => {
    const built = buildInsertPatch(fields, draft);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    mutate(
      {
        ref: storeRef,
        child: childName,
        ...(tenant ? { tenant } : {}),
        patch: built.patch,
        commit: true,
      },
      {
        onSuccess: () => {
          if (createMore) {
            setDraft(defaultInsertDraft(fields));
            return;
          }
          onOpenChange(false);
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    if (!isPending) submit();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="sql-insert-sheet"
        onKeyDown={onKeyDown}
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Add new row to {childName}</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{storeRef}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {fields.map((col) => {
            const value = draft[col.key] ?? "";
            return (
              <SheetField
                key={col.key}
                label={col.key}
                hint={col.type === "integer" || col.type === "number" ? "integer" : col.type}
              >
                {col.type === "json" ? (
                  <textarea
                    value={value}
                    onChange={(event) => setField(col.key, event.target.value)}
                    aria-label={col.key}
                    placeholder="Default: NULL"
                    spellCheck={false}
                    className="min-h-20 w-full resize-y rounded-none border-0 bg-transparent px-4 py-1.5 font-mono text-[11px] leading-5 outline-none"
                  />
                ) : (
                  <Input
                    value={value}
                    onChange={(event) => setField(col.key, event.target.value)}
                    aria-label={col.key}
                    placeholder={col.key === "id" ? undefined : "Default: NULL"}
                    type={col.type === "integer" || col.type === "number" ? "number" : "text"}
                    flat
                    className={cn(SHEET_CONTROL, "font-mono")}
                    autoFocus={col.key === "id"}
                  />
                )}
              </SheetField>
            );
          })}
          {error ? <SheetError slot="sql-insert-error">{error}</SheetError> : null}
        </div>

        <SheetSwitchRow label="Create more">
          <Switch
            size="sm"
            checked={createMore}
            onCheckedChange={setCreateMore}
            ariaLabel="Create more"
          />
        </SheetSwitchRow>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending}
            onClick={submit}
            data-slot="sql-insert-submit"
          >
            {isPending ? "Saving…" : "Save"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
