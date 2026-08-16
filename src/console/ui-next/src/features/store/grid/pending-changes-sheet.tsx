/**
 * Pending Changes sheet — Visual (File Diff) + SQL tabs, Clear All / Commit All.
 */

import { useMemo, useState, type JSX } from "react";
import { Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileDiff } from "@/components/agents/file-diff.tsx";
import { Button } from "@/components/ui/button";
import { SheetError, SheetFooterButton } from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils.ts";
import { pendingToUpdates, type PendingCell } from "../lib/pending-edits.ts";
import { formatGridCell } from "../lib/grid-model.ts";
import { pendingChangePath, pendingToKv, pendingToSql } from "../lib/pending-sql.ts";

/** Props for {@link PendingChangesSheet}. */
export interface PendingChangesSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: ReadonlyMap<string, PendingCell>;
  readonly table: string;
  /** SQL tables keep the SQL tab; KV shows `set()` instead. */
  readonly facet?: "sql" | "kv";
  readonly saving: boolean;
  readonly error?: string | null;
  readonly onUndoCell: (rowId: string, key: string) => void;
  readonly onClearAll: () => void;
  readonly onCommitAll: () => void;
}

/**
 * Right-side review of staged Store edits before they hit `storeEdit`.
 *
 * @param props - Pending map + commit/discard callbacks
 */
export function PendingChangesSheet({
  open,
  onOpenChange,
  pending,
  table,
  facet = "sql",
  saving,
  error,
  onUndoCell,
  onClearAll,
  onCommitAll,
}: PendingChangesSheetProps): JSX.Element {
  const [tab, setTab] = useState<"visual" | "script">("visual");
  const updates = useMemo(() => pendingToUpdates(pending), [pending]);
  const isKv = facet === "kv";
  const scriptText = useMemo(
    () => (isKv ? pendingToKv({ updates }) : pendingToSql({ table, updates })),
    [isKv, table, updates],
  );
  const scriptLines = useMemo(
    () =>
      scriptText.split("\n").map((content, index) => ({
        id: `script-${index}`,
        type:
          content.startsWith("--") || content.startsWith("//")
            ? ("context" as const)
            : ("added" as const),
        newLine: index + 1,
        content,
      })),
    [scriptText],
  );
  const count = pending.size;
  const shortcut =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘S" : "Ctrl+S";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="w-[24rem] gap-0 p-0 sm:max-w-md"
        data-slot="pending-changes-sheet"
      >
        <SheetHeader className="gap-2 border-b border-border/50">
          <SheetTitle>Pending Changes</SheetTitle>
          <SheetDescription className="sr-only">
            Review staged cell edits, then commit or discard them.
          </SheetDescription>
          <div className="flex items-center gap-4" role="tablist" aria-label="Pending changes view">
            <TabButton active={tab === "visual"} onClick={() => setTab("visual")} id="visual">
              Visual
            </TabButton>
            <TabButton active={tab === "script"} onClick={() => setTab("script")} id="script">
              {isKv ? "KV" : "SQL"}
            </TabButton>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          {count === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              No pending changes.
            </p>
          ) : tab === "visual" ? (
            <ul className="flex flex-col gap-3" data-slot="pending-visual">
              {updates.map((update) => {
                const path = pendingChangePath({
                  table,
                  rowId: update.rowId,
                  key: update.key,
                });
                return (
                  <li
                    key={`${update.rowId}\0${update.key}`}
                    className="overflow-hidden rounded-lg border border-border/70"
                  >
                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                      <span
                        className="grid size-5 shrink-0 place-items-center rounded-md bg-amber-700/50 font-mono text-[10px] font-bold text-amber-100"
                        title="Update"
                      >
                        U
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {path}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={saving}
                        aria-label={`Undo ${path}`}
                        onClick={() => onUndoCell(update.rowId, update.key)}
                      >
                        <HugeiconsIcon icon={Undo02Icon} className="size-3.5" />
                      </Button>
                    </div>
                    <div className="font-mono text-xs leading-5">
                      <div className="flex gap-1.5 bg-rose-500/[0.12] px-2.5 py-0.5 text-rose-700 dark:text-rose-300">
                        <span className="w-3 shrink-0 select-none">−</span>
                        <span className="min-w-0 break-all">{formatGridCell(update.prev)}</span>
                      </div>
                      <div className="flex gap-1.5 bg-emerald-500/[0.12] px-2.5 py-0.5 text-emerald-800 dark:text-emerald-300">
                        <span className="w-3 shrink-0 select-none">+</span>
                        <span className="min-w-0 break-all">{formatGridCell(update.next)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <FileDiff
              file={isKv ? `${table}.ts` : `${table}.sql`}
              lines={scriptLines}
              status="complete"
              collapseOnComplete={false}
              defaultOpen
              language={isKv ? "typescript" : "sql"}
              maxHeight={480}
              copyText={scriptText}
              className="min-w-0"
            />
          )}
        </div>

        {error ? <SheetError>{error}</SheetError> : null}

        <SheetFooter>
          <SheetFooterButton split disabled={saving || count === 0} onClick={onClearAll}>
            Clear All
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={saving || count === 0}
            onClick={onCommitAll}
            data-slot="commit-all"
          >
            {saving ? "Committing…" : `Commit All (${count})`}
            <kbd className="ml-1.5 rounded border border-primary-foreground/30 px-1 font-mono text-[10px] opacity-80">
              {shortcut}
            </kbd>
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
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
      aria-selected={active}
      id={`pending-tab-${id}`}
      onClick={onClick}
      className={cn(
        "px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase transition-colors hover:bg-muted/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
