/**
 * Store row detail Sheet — Fields / JSON tabs, in-sheet edit, delete.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import {
  Cancel01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HighlightedJson } from "@/components/highlighted-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHEET_CONTROL, SheetError } from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useStoreEdit } from "../data/use-store-edit.ts";
import { RevealCell } from "./reveal-cell.tsx";
import {
  formatGridCell,
  type StoreGridColumn,
  type StoreGridModel,
  type StoreGridRow,
} from "../lib/grid-model.ts";
import { isStorePiiMask, parseStoreCellDraft, sanitizeStorePatch } from "../lib/patch.ts";
import { isRtlText } from "../lib/rtl.ts";

/** Props for {@link StoreRowDetailSheet}. */
export interface StoreRowDetailSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly model: StoreGridModel;
  readonly row: StoreGridRow | null;
  readonly facet: "sql" | "kv" | "files" | "index";
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly masked?: boolean;
  readonly asGate?: string | null;
  readonly asUserId?: string | null;
  readonly onDeleteRow?: (row: StoreGridRow) => void;
}

/**
 * Right-side detail for one grid row — Fields (Reveal / edit) and full JSON.
 *
 * @param props - Selected row + facet + mutation callbacks
 */
export function StoreRowDetailSheet({
  open,
  onOpenChange,
  model,
  row,
  facet,
  storeRef,
  childName,
  tenant,
  masked = false,
  asGate = null,
  asUserId = null,
  onDeleteRow,
}: StoreRowDetailSheetProps): JSX.Element {
  const edit = useStoreEdit();
  const [tab, setTab] = useState<"fields" | "json">("fields");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const editableColumns = useMemo(
    () => model.columns.filter((col) => col.editable),
    [model.columns],
  );
  const canEdit =
    model.editable && (facet === "sql" || facet === "kv") && editableColumns.length > 0;

  useEffect(() => {
    if (!open) return;
    setTab("fields");
    setEditing(false);
    setError(null);
  }, [open, row]);

  const json = useMemo(() => {
    if (!row) return "";
    try {
      return JSON.stringify(row.cells, null, 2);
    } catch {
      return "[unserializable row]";
    }
  }, [row]);

  if (!row) return <></>;

  const startEdit = (): void => {
    const next: Record<string, string> = {};
    for (const col of editableColumns) {
      next[col.key] = draftFromCell(col.type, row.cells[col.key]);
    }
    setDraft(next);
    setError(null);
    setEditing(true);
    setTab("fields");
  };

  const save = async (): Promise<void> => {
    setError(null);
    const patch: Record<string, unknown> = {};
    for (const col of editableColumns) {
      const text = draft[col.key] ?? "";
      if (col.pii && text.trim() === "") continue;
      if (text === draftFromCell(col.type, row.cells[col.key])) continue;
      patch[col.key] = parseStoreCellDraft(col.type, text);
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    try {
      await edit.mutateAsync({
        ref: storeRef,
        ...(facet === "sql" ? { child: childName, id: row.id } : { key: row.id }),
        ...(tenant ? { tenant } : {}),
        ...(asGate ? { asGate } : {}),
        ...(asUserId ? { asUserId } : {}),
        patch: sanitizeStorePatch(patch),
        commit: true,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 sm:max-w-md"
        data-slot="store-row-detail-sheet"
        data-editing={editing ? "true" : "false"}
      >
        <SheetHeader className="gap-2 border-b border-border/50">
          <div className="flex flex-col gap-0.5 pr-8">
            <SheetTitle className="text-sm">
              {editing ? "Edit" : "Row"} <span className="font-mono">{row.id}</span>
            </SheetTitle>
            <SheetDescription className="font-mono text-[11px]">
              {storeRef}
              {facet === "sql" ? `/${childName}` : ""}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-4" role="tablist" aria-label="Row detail tabs">
            <TabButton active={tab === "fields"} onClick={() => setTab("fields")} id="fields">
              Fields
            </TabButton>
            <TabButton active={tab === "json"} onClick={() => setTab("json")} id="json">
              JSON
            </TabButton>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2">
          {tab === "fields" ? (
            <ul className="flex flex-col divide-y divide-border/50" data-slot="row-fields">
              {model.columns.map((col) => {
                const value = row.cells[col.key];
                const maskedPii = col.pii && masked && isStorePiiMask(value);
                const fieldEditable = editing && col.editable;
                return (
                  <li key={col.key} className="flex items-baseline gap-3 py-1.5">
                    <span className="flex w-32 shrink-0 items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] font-medium text-muted-foreground">
                        {col.key}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground/60">
                        {col.type === "integer" || col.type === "number"
                          ? "123"
                          : col.type === "json"
                            ? "{ }"
                            : "abc"}
                      </span>
                      {col.primaryKey ? (
                        <span className="shrink-0 font-mono text-[9px] text-amber-600 dark:text-amber-400">
                          PK
                        </span>
                      ) : null}
                      {col.pii ? (
                        <span className="shrink-0 font-mono text-[9px] text-sky-600 dark:text-sky-400">
                          PII
                        </span>
                      ) : null}
                    </span>
                    {fieldEditable ? (
                      col.type === "json" ? (
                        <textarea
                          value={draft[col.key] ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [col.key]: event.target.value }))
                          }
                          aria-label={col.key}
                          rows={3}
                          className="min-h-16 min-w-0 flex-1 rounded-none border-0 bg-transparent font-mono text-[11px] outline-none"
                        />
                      ) : (
                        <Input
                          value={draft[col.key] ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [col.key]: event.target.value }))
                          }
                          type={col.type === "integer" || col.type === "number" ? "number" : "text"}
                          aria-label={col.key}
                          flat
                          className={cn(SHEET_CONTROL, "min-w-0 flex-1 px-0 font-mono")}
                        />
                      )
                    ) : maskedPii ? (
                      <RevealCell
                        refName={storeRef}
                        child={childName}
                        {...(tenant ? { tenant } : {})}
                        rowId={row.id}
                        column={col.key}
                        maskedValue={value}
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 font-mono text-[11px] break-words"
                        dir={isRtlText(value) ? "rtl" : "ltr"}
                      >
                        {formatGridCell(value)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-border/60" data-slot="row-json">
              <HighlightedJson
                json={json}
                dataSlot="store-row-json"
                className="flex max-h-none overflow-auto"
              />
            </div>
          )}
        </div>

        {error ? <SheetError slot="row-detail-error">{error}</SheetError> : null}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={edit.isPending}
                data-slot="row-detail-cancel"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={edit.isPending}
                data-slot="row-detail-save"
              >
                <HugeiconsIcon icon={Tick02Icon} className="size-3.5" aria-hidden />
                {edit.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startEdit}
              data-slot="row-detail-edit"
            >
              <HugeiconsIcon icon={PencilEdit01Icon} className="size-3.5" aria-hidden />
              Edit
            </Button>
          ) : (
            <span />
          )}
          {!editing && onDeleteRow ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onDeleteRow(row)}
              data-slot="row-detail-delete"
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-3.5" aria-hidden />
              Delete 1 row
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Seed / compare an edit draft without turning `null` into the display em dash. */
function draftFromCell(type: StoreGridColumn["type"], raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (isStorePiiMask(raw)) return "";
  if (type === "json") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return "";
    }
  }
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

function TabButton({
  active,
  onClick,
  id,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly id: string;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors hover:bg-muted/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      data-slot={`row-tab-${id}`}
    >
      {children}
    </button>
  );
}
