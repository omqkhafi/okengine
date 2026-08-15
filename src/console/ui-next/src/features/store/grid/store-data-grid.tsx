/**
 * Store browse grid — beUI editable Table wired to the console store API.
 *
 * Inline cell edits stage locally (brown/tan) until Changes opens Pending Changes.
 * Drag a cell range to multi-select; paste or type fills the range.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Cancel01Icon,
  Database01Icon,
  Delete02Icon,
  FileExportIcon,
  FileImportIcon,
  Key01Icon,
  LeftToRightListBulletIcon,
  LinkSquare02Icon,
  PlusSignIcon,
  PuzzleIcon,
  Redo02Icon,
  Search01Icon,
  SecurityCheckIcon,
  Tick02Icon,
  Undo02Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Switch } from "@/components/motion/switch.tsx";
import { Table, type SortState, type TableColumn } from "@/components/motion/table/index.tsx";
import { EditableCell } from "@/components/motion/table/editable-cell.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils.ts";
import { useStoreEdit } from "../data/use-store-edit.ts";
import { JsonValueSheet } from "../detail/json-value-sheet.tsx";
import { RevealCell } from "../detail/reveal-cell.tsx";
import { asInspectableJson, jsonValueEqual } from "../lib/json-value.ts";
import { parseKvTtlDraft } from "../lib/kv-meta.ts";
import { KvAddSheet } from "./kv-add-sheet.tsx";
import { SqlInsertSheet } from "./sql-insert-sheet.tsx";
import { PendingChangesSheet } from "./pending-changes-sheet.tsx";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import {
  EMPTY_EDIT_HISTORY,
  invertEditBatch,
  popRedo,
  popUndo,
  pushEditBatch,
  type CellUpdate,
  type EditHistory,
} from "../lib/edit-history.ts";
import {
  formatGridCell,
  formatStoreCell,
  type StoreGridColumn,
  type StoreGridModel,
  type StoreGridRow,
} from "../lib/grid-model.ts";
import { kvValueSizeBytes } from "../lib/kv-meta.ts";
import { isStorePiiMask, parseStoreCellDraft, sanitizeStorePatch } from "../lib/patch.ts";
import {
  fillHits,
  pasteHits,
  pendingKey,
  pendingToUpdates,
  popPending,
  stagePending,
  type PasteHit,
  type PendingCell,
} from "../lib/pending-edits.ts";
import { isRtlText } from "../lib/rtl.ts";
import {
  matrixToTsv,
  rangeArea,
  rangeBounds,
  tsvToMatrix,
  type CellRange,
} from "../lib/cell-selection.ts";
import { cellExportText, importHits, parseImportRecords, rowsToCsv } from "../lib/grid-transfer.ts";

/** Props for {@link StoreDataGrid}. */
export interface StoreDataGridProps {
  readonly model: StoreGridModel;
  readonly facet: "sql" | "kv" | "files" | "index";
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly masked?: boolean;
  readonly routedRole?: "primary" | "replica";
  /** Current browse limit (for honest find copy). */
  readonly limit: number;
  /** Toolbar controls rendered left of the find input (Refresh, Writers/Readers, …). */
  readonly toolbarExtras?: ReactNode;
  /**
   * Server-side index query. When set, the toolbar find field queries the
   * index (and shows topK) instead of filtering this page.
   */
  readonly indexSearch?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly topK: number;
    readonly onTopKChange: (topK: number) => void;
  };
  /** Controlled SQL insert sheet (button lives in {@link toolbarExtras}). */
  readonly insertOpen?: boolean;
  readonly onInsertOpenChange?: (open: boolean) => void;
  readonly onDeleteRows?: (rows: readonly StoreGridRow[]) => void;
}

/** Row height presets (px) for the height menu. */
const ROW_HEIGHTS = { short: 26, medium: 34, tall: 44, "extra-tall": 56 } as const;
type RowHeight = keyof typeof ROW_HEIGHTS;

/** Fixed column width (px) by cell variant. */
function columnWidthPx(type: StoreGridColumn["type"], key: string): number {
  if (key === "id" || key === "key" || key === "name") return 192;
  if (key === "title") return 300;
  if (key === "version") return 72;
  if (key === "ttl") return 88;
  if (key === "size") return 80;
  if (key === "enabled") return 88;
  if (key === "source") return 112;
  switch (type) {
    case "boolean":
      return 88;
    case "integer":
    case "number":
      return 112;
    case "json":
      return 288;
    default:
      return 224;
  }
}

/** Tiny muted type glyph for the header (quiet alternative to pills). */
function typeGlyph(type: StoreGridColumn["type"]): string {
  switch (type) {
    case "integer":
    case "number":
      return "123";
    case "json":
      return "{ }";
    case "boolean":
      return "01";
    default:
      return "abc";
  }
}

function isNumericType(type: StoreGridColumn["type"]): boolean {
  return type === "integer" || type === "number";
}

function parseGridDraft(
  col: StoreGridColumn,
  text: string,
): { readonly ok: true; readonly next: unknown } | { readonly ok: false } {
  if (col.format === "ttl") {
    const parsed = parseKvTtlDraft(text);
    if (parsed === undefined) return { ok: false };
    return { ok: true, next: parsed };
  }
  return { ok: true, next: text.trim() === "" ? null : parseStoreCellDraft(col.type, text) };
}

/** Serialize a raw cell value into the inline editor's draft text. */
function cellDraftText(col: StoreGridColumn, raw: unknown): string {
  if (col.format === "ttl") return "";
  if (raw === null || raw === undefined) return "";
  if (col.type === "json") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

/**
 * Virtualized editable table for Store browse results.
 *
 * @param props - Normalized model + facet + callbacks
 */
export function StoreDataGrid({
  model,
  facet,
  storeRef,
  childName,
  tenant,
  masked = false,
  routedRole,
  limit,
  toolbarExtras,
  indexSearch,
  insertOpen = false,
  onInsertOpenChange,
  onDeleteRows,
}: StoreDataGridProps): JSX.Element {
  const [findText, setFindText] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(new Set());
  const [rowHeight, setRowHeight] = useState<RowHeight>("medium");
  const [sort, setSort] = useState<SortState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistory>(EMPTY_EDIT_HISTORY);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingCell>>(new Map());
  const [lastFocus, setLastFocus] = useState<{ rowId: string; key: string } | null>(null);
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: string } | null>(null);
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [inspect, setInspect] = useState<{
    readonly rowId: string;
    readonly column: string;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(440);
  const viewportRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(pending);
  const pendingLogRef = useRef<readonly string[]>([]);
  pendingRef.current = pending;
  const edit = useStoreEdit();

  const hasSelect = onDeleteRows !== undefined;
  const canInlineEdit = model.editable && (facet === "sql" || facet === "kv");
  const rowHeightPx = ROW_HEIGHTS[rowHeight];

  const visibleColumns = useMemo(
    () => model.columns.filter((c) => !hiddenCols.has(c.key)),
    [model.columns, hiddenCols],
  );

  const overlayValue = (row: StoreGridRow, key: string): unknown => {
    if (facet === "kv" && key === "size") {
      const val = pending.get(pendingKey(row.id, "value"))?.next ?? row.cells.value;
      return kvValueSizeBytes(val);
    }
    return pending.get(pendingKey(row.id, key))?.next ?? row.cells[key];
  };

  const indexMode = indexSearch !== undefined;
  const findValue = indexMode ? indexSearch.value : findText;

  const filteredRows = useMemo(() => {
    if (indexMode || !findText.trim()) return model.rows;
    const q = findText.trim().toLowerCase();
    return model.rows.filter((row) =>
      model.columns.some((col) => {
        const text = formatStoreCell(col, overlayValue(row, col.key)).toLowerCase();
        if (text.includes(q)) return true;
        if (col.format !== "name-key") return false;
        const key = row.cells.name;
        const version = row.cells.version;
        return (
          (typeof key === "string" && key.toLowerCase().includes(q)) ||
          (version != null && String(version).toLowerCase().includes(q))
        );
      }),
    );
  }, [model.rows, model.columns, findText, pending, indexMode]);

  const viewRows = useMemo(() => {
    if (!sort) return filteredRows;
    const column =
      visibleColumns.find((c) => c.key === sort.key) ??
      model.columns.find((c) => c.key === sort.key);
    if (!column) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const av = overlayValue(a, column.key);
      const bv = overlayValue(b, column.key);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : formatGridCell(av).localeCompare(formatGridCell(bv));
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sort, pending, visibleColumns, model.columns]);

  useEffect(() => {
    setSelected([]);
    setHiddenCols(new Set());
    setEditError(null);
    setHistory(EMPTY_EDIT_HISTORY);
    setPending(new Map());
    pendingLogRef.current = [];
    setLastFocus(null);
    setCellRange(null);
    setEditingCell(null);
    setEditSeed(null);
    setChangesOpen(false);
    setInspect(null);
    setAddOpen(false);
    setSort(null);
    setFindText("");
  }, [facet, storeRef, childName, tenant]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setViewportHeight(Math.max(120, Math.round(h)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedRows = useMemo(
    () => model.rows.filter((r) => selected.includes(r.id)),
    [model.rows, selected],
  );

  const isCellEditable = (col: StoreGridColumn, raw: unknown): boolean =>
    canInlineEdit && col.editable && !(col.pii && masked && isStorePiiMask(raw));

  const writePending = (
    nextPending: ReadonlyMap<string, PendingCell>,
    nextLog: readonly string[],
  ) => {
    pendingRef.current = nextPending;
    pendingLogRef.current = nextLog;
    setPending(nextPending);
  };

  const writableCell = (rowId: string, key: string): boolean => {
    const row = model.rows.find((r) => r.id === rowId);
    const col = model.columns.find((c) => c.key === key);
    if (!row || !col) return false;
    return isCellEditable(col, row.cells[key]);
  };

  const applyHits = (hits: readonly PasteHit[]): number => {
    if (hits.length === 0) return 0;
    let nextPending = pendingRef.current;
    let nextLog = pendingLogRef.current;
    for (const hit of hits) {
      const row = model.rows.find((r) => r.id === hit.rowId);
      const col = model.columns.find((c) => c.key === hit.key);
      if (!row || !col) continue;
      const raw = row.cells[col.key];
      const parsed = parseGridDraft(col, hit.text);
      if (!parsed.ok) continue;
      const next = parsed.next;
      const staged = stagePending(nextPending, nextLog, {
        rowId: row.id,
        key: col.key,
        prev: raw,
        next,
      });
      nextPending = staged.pending;
      nextLog = staged.log;
    }
    writePending(nextPending, nextLog);
    return hits.length;
  };

  const exportRows = (format: "csv" | "json") => {
    const rows =
      selected.length > 0 ? viewRows.filter((row) => selected.includes(row.id)) : viewRows;
    const keys = visibleColumns.map((col) => col.key);
    if (rows.length === 0 || keys.length === 0) return;
    const stamp = selected.length > 0 ? "selection" : "page";
    const safeName = childName.replace(/[^\w.-]+/g, "_");
    if (format === "csv") {
      const body = rows.map((row) => keys.map((key) => cellExportText(overlayValue(row, key))));
      downloadText(
        `${safeName}-${stamp}.csv`,
        `\uFEFF${rowsToCsv(keys, body)}`,
        "text/csv;charset=utf-8",
      );
    } else {
      const records = rows.map((row) => {
        const rec: Record<string, unknown> = {};
        for (const key of keys) rec[key] = overlayValue(row, key) ?? null;
        return rec;
      });
      downloadText(
        `${safeName}-${stamp}.json`,
        `${JSON.stringify(records, null, 2)}\n`,
        "application/json",
      );
    }
    setNotice(`Exported ${rows.length} row(s)`);
  };

  const onImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canInlineEdit) return;
    void file.text().then((text) => {
      try {
        const records = parseImportRecords(text);
        if (records.length === 0) {
          setNotice("No rows in import file");
          return;
        }
        const { hits, unmatched } = importHits({
          records,
          rowIds: new Set(model.rows.map((row) => row.id)),
          writable: writableCell,
        });
        if (hits.length === 0) {
          setEditError(
            unmatched === records.length
              ? "No matching rows — import needs an id or key that exists on this page"
              : "Nothing writable to import",
          );
          return;
        }
        const n = applyHits(hits);
        setEditError(null);
        setNotice(
          unmatched > 0
            ? `Imported ${n} cell(s) · ${unmatched} row(s) unmatched`
            : `Imported ${n} cell(s)`,
        );
      } catch (err) {
        setEditError(err instanceof Error ? err.message : "Could not parse import file");
      }
    });
  };

  const stageCell = (row: StoreGridRow, col: StoreGridColumn, text: string) => {
    const raw = row.cells[col.key];
    if (!isCellEditable(col, raw)) return;
    const parsed = parseGridDraft(col, text);
    if (!parsed.ok) {
      setEditError("TTL must be a duration like 30m, 1h, or empty to clear");
      return;
    }
    setEditError(null);
    const next = parsed.next;
    const staged = stagePending(pendingRef.current, pendingLogRef.current, {
      rowId: row.id,
      key: col.key,
      prev: raw,
      next,
    });
    writePending(staged.pending, staged.log);
  };

  const stageRawCell = (rowId: string, key: string, next: unknown) => {
    const row = model.rows.find((r) => r.id === rowId);
    const col = model.columns.find((c) => c.key === key);
    if (!row || !col) return;
    const raw = row.cells[col.key];
    if (!isCellEditable(col, raw)) return;
    const staged = stagePending(pendingRef.current, pendingLogRef.current, {
      rowId: row.id,
      key: col.key,
      prev: raw,
      next: jsonValueEqual(raw, next) ? raw : next,
    });
    writePending(staged.pending, staged.log);
  };

  const undoPendingCell = (rowId: string, key: string) => {
    const k = pendingKey(rowId, key);
    const next = new Map(pendingRef.current);
    next.delete(k);
    writePending(
      next,
      pendingLogRef.current.filter((entry) => entry !== k),
    );
  };

  const commitBatch = async (
    updates: readonly CellUpdate[],
    opts?: { track?: boolean; notice?: string },
  ): Promise<boolean> => {
    if (updates.length === 0) return true;
    const byRow = new Map<string, Record<string, unknown>>();
    for (const u of updates) {
      const patch = byRow.get(u.rowId) ?? {};
      patch[u.key] = u.next;
      byRow.set(u.rowId, patch);
    }
    setSaving(true);
    setEditError(null);
    let ok = true;
    try {
      await Promise.all(
        [...byRow.entries()].map(([rowId, patch]) =>
          edit.mutateAsync({
            ref: storeRef,
            ...(facet === "sql" ? { child: childName, id: rowId } : { key: rowId }),
            ...(tenant ? { tenant } : {}),
            patch: sanitizeStorePatch(patch),
            commit: true,
          }),
        ),
      );
      if (opts?.track !== false) {
        setHistory((h) => pushEditBatch(h, { updates, at: Date.now() }));
      }
      if (opts?.notice) setNotice(opts.notice);
    } catch (error) {
      ok = false;
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
    return ok;
  };

  const onUndo = () => {
    if (saving) return;
    if (pendingRef.current.size > 0) {
      const popped = popPending(pendingRef.current, pendingLogRef.current);
      writePending(popped.pending, popped.log);
      return;
    }
    const { history: next, batch } = popUndo(history);
    if (!batch) return;
    setHistory(next);
    void commitBatch(invertEditBatch(batch).updates, {
      track: false,
      notice: `Undid ${batch.updates.length} cell(s)`,
    });
  };

  const onRedo = () => {
    if (saving || pending.size > 0) return;
    const { history: next, batch } = popRedo(history);
    if (!batch) return;
    setHistory(next);
    void commitBatch(batch.updates, {
      track: false,
      notice: `Redid ${batch.updates.length} cell(s)`,
    });
  };

  const startEdit = (rowId: string, key: string, seed?: string) => {
    if (saving) return;
    const row = model.rows.find((r) => r.id === rowId);
    const col = model.columns.find((c) => c.key === key);
    if (!row || !col || !isCellEditable(col, row.cells[key])) return;
    setLastFocus({ rowId, key });
    setEditSeed(seed === undefined ? null : seed);
    setEditingCell({ rowId, key });
  };

  const onCellEdit = (rowId: string, columnKey: string, value: string) => {
    if (saving) return;
    const row = model.rows.find((r) => r.id === rowId);
    const col = model.columns.find((c) => c.key === columnKey);
    if (!row || !col) return;
    if (col.type === "boolean") {
      const parsed = parseGridDraft(col, value);
      if (!parsed.ok) return;
      void commitBatch([{ rowId, key: columnKey, prev: row.cells[columnKey], next: parsed.next }], {
        notice: parsed.next === true ? `Enabled ${rowId}` : `Disabled ${rowId}`,
      });
      return;
    }
    if (cellRange && rangeArea(cellRange) > 1) {
      applyHits(
        fillHits({
          range: cellRange,
          rowIds: viewRows.map((r) => r.id),
          columnKeys: visibleColumns.map((c) => c.key),
          text: value,
          writable: writableCell,
        }),
      );
      return;
    }
    stageCell(row, col, value);
  };

  const openChanges = () => {
    if (pendingRef.current.size === 0) return;
    setChangesOpen(true);
  };

  const applyPending = () => {
    if (saving || pendingRef.current.size === 0) return;
    const updates = pendingToUpdates(pendingRef.current);
    void commitBatch(updates, { notice: `Applied ${updates.length} change(s)` }).then((ok) => {
      if (ok) {
        writePending(new Map(), []);
        setChangesOpen(false);
      }
    });
  };

  const discardPending = () => {
    if (saving) return;
    writePending(new Map(), []);
    setChangesOpen(false);
  };

  useEffect(() => {
    if (!changesOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      applyPending();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changesOpen]);

  const pasteTargetRows = (): StoreGridRow[] => {
    if (selected.length > 1) {
      return viewRows.filter((r) => selected.includes(r.id));
    }
    const startId = lastFocus?.rowId ?? selected[0] ?? viewRows[0]?.id;
    if (!startId) return [];
    const start = viewRows.findIndex((r) => r.id === startId);
    if (start < 0) return [];
    return viewRows.slice(start);
  };

  const applyPasteMatrix = (matrix: string[][]) => {
    if (!canInlineEdit || saving || matrix.length === 0) return;
    const columnKeys = visibleColumns.map((c) => c.key);
    let hits: PasteHit[] = [];
    if (cellRange) {
      const b = rangeBounds(cellRange);
      const rowIds: string[] = [];
      for (let r = b.minRow; r <= b.maxRow; r++) {
        const row = viewRows[r];
        if (row) rowIds.push(row.id);
      }
      hits = pasteHits({
        matrix,
        rowIds,
        columnKeys,
        startCol: b.minCol,
        writable: writableCell,
      });
    } else {
      const targets = pasteTargetRows();
      if (targets.length === 0) return;
      const startKey = lastFocus?.key;
      const startCol = Math.max(
        0,
        startKey ? visibleColumns.findIndex((c) => c.key === startKey) : 0,
      );
      const rowIds =
        selected.length > 1
          ? targets.map((r) => r.id)
          : targets.slice(0, matrix.length).map((r) => r.id);
      hits = pasteHits({
        matrix,
        rowIds,
        columnKeys,
        startCol,
        writable: writableCell,
      });
    }
    const n = applyHits(hits);
    if (n > 0) setNotice(`Pasted ${n} cell(s)`);
  };

  const copySelection = async () => {
    const matrix: string[][] = [];
    if (cellRange) {
      const b = rangeBounds(cellRange);
      for (let r = b.minRow; r <= b.maxRow; r++) {
        const row = viewRows[r];
        if (!row) continue;
        const line: string[] = [];
        for (let c = b.minCol; c <= b.maxCol; c++) {
          const col = visibleColumns[c];
          line.push(col ? formatGridCell(overlayValue(row, col.key)) : "");
        }
        matrix.push(line);
      }
    } else {
      const rows = selected.length > 0 ? viewRows.filter((r) => selected.includes(r.id)) : [];
      if (rows.length > 0) {
        for (const row of rows) {
          matrix.push(visibleColumns.map((col) => formatGridCell(overlayValue(row, col.key))));
        }
      } else if (lastFocus) {
        const row = model.rows.find((r) => r.id === lastFocus.rowId);
        if (row) matrix.push([formatGridCell(overlayValue(row, lastFocus.key))]);
      }
    }
    if (matrix.length === 0) return;
    try {
      await navigator.clipboard.writeText(matrixToTsv(matrix));
      setNotice(`Copied ${matrix.length} row(s)`);
    } catch {
      setEditError("Clipboard write blocked — allow clipboard access in the browser prompt.");
    }
  };

  const isFindInput = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (findRef.current === target || findRef.current?.contains(target) === true);

  const isToolbarField = (target: EventTarget | null): boolean =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  const nativeTextSelected = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement))
      return false;
    return target.selectionStart !== target.selectionEnd;
  };

  const tableColumns = useMemo<TableColumn<StoreGridRow>[]>(
    () =>
      visibleColumns.map((col) => ({
        key: col.key,
        header: <StoreColumnHeader col={col} />,
        sortable: true,
        align: isNumericType(col.type) ? "right" : "left",
        width: col.key === "comment" ? undefined : `${columnWidthPx(col.type, col.key)}px`,
        fill: col.key === "comment",
        sortValue: (row) => {
          const raw = overlayValue(row, col.key);
          if (typeof raw === "number") return raw;
          return formatGridCell(raw);
        },
        cell: (row) => {
          const staged = pending.get(pendingKey(row.id, col.key));
          const display = staged ? staged.next : row.cells[col.key];
          return (
            <StoreGridBodyCell
              row={row}
              col={col}
              storeRef={storeRef}
              childName={childName}
              tenant={tenant}
              masked={masked}
              editable={
                canInlineEdit &&
                col.editable &&
                !(col.pii && masked && isStorePiiMask(row.cells[col.key]))
              }
              saving={saving}
              dirty={staged !== undefined}
              editing={editingCell?.rowId === row.id && editingCell.key === col.key}
              draftSeed={
                editingCell?.rowId === row.id && editingCell.key === col.key ? editSeed : null
              }
              displayValue={display}
              onFocus={() => setLastFocus({ rowId: row.id, key: col.key })}
              onStartEdit={() => startEdit(row.id, col.key)}
              onEditEnd={() => {
                setEditingCell(null);
                setEditSeed(null);
              }}
              onCommit={(next) => onCellEdit(row.id, col.key, next)}
              onInspect={() => setInspect({ rowId: row.id, column: col.key })}
              onUpgrade={
                row.cells.upgrade === true
                  ? () => {
                      void commitBatch(
                        [{ rowId: row.id, key: "upgrade", prev: row.cells.upgrade, next: true }],
                        {
                          notice: `Upgraded ${row.id}`,
                          track: false,
                        },
                      );
                    }
                  : undefined
              }
            />
          );
        },
      })),
    [
      visibleColumns,
      storeRef,
      childName,
      tenant,
      masked,
      saving,
      canInlineEdit,
      pending,
      editingCell,
      editSeed,
      commitBatch,
    ],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findRef.current?.focus();
      return;
    }
    if (isFindInput(event.target) || isToolbarField(event.target)) return;
    if (meta && event.key.toLowerCase() === "enter") {
      if (pendingRef.current.size > 0) {
        event.preventDefault();
        if (changesOpen) applyPending();
        else openChanges();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      if (pendingRef.current.size > 0) {
        event.preventDefault();
        if (changesOpen) applyPending();
        else openChanges();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      onRedo();
      return;
    }
    if (event.key === "Escape") {
      if (isFindInput(event.target)) return;
      if (!editingCell && !cellRange) return;
      event.preventDefault();
      setEditingCell(null);
      setEditSeed(null);
      setCellRange(null);
      event.currentTarget.focus({ preventScroll: true });
      return;
    }
    if (editingCell) return;
    if (event.key === "Enter" && cellRange) {
      event.preventDefault();
      const row = viewRows[cellRange.head.row];
      const col = visibleColumns[cellRange.head.col];
      if (row && col) startEdit(row.id, col.key);
      return;
    }
    if (
      cellRange &&
      canInlineEdit &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const row = viewRows[cellRange.head.row];
      const col = visibleColumns[cellRange.head.col];
      if (row && col) {
        event.preventDefault();
        startEdit(row.id, col.key, event.key);
      }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && cellRange && canInlineEdit) {
      event.preventDefault();
      const n = applyHits(
        fillHits({
          range: cellRange,
          rowIds: viewRows.map((r) => r.id),
          columnKeys: visibleColumns.map((c) => c.key),
          text: "",
          writable: writableCell,
        }),
      );
      if (n > 0) setNotice(`Cleared ${n} cell(s)`);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (isFindInput(event.target) || nativeTextSelected(event.target)) return;
    if (selected.length === 0 && !lastFocus && !cellRange) return;
    event.preventDefault();
    void copySelection();
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canInlineEdit || isFindInput(event.target)) return;
    const text = event.clipboardData.getData("text/plain");
    const matrix = tsvToMatrix(text);
    const bulk = selected.length > 1 || matrix.length > 1 || (matrix[0]?.length ?? 0) > 1;
    if (!bulk && event.target instanceof HTMLInputElement) return;
    if (matrix.length === 0) return;
    event.preventDefault();
    applyPasteMatrix(matrix);
  };

  const inspectRow = inspect ? model.rows.find((row) => row.id === inspect.rowId) : undefined;
  const inspectCol = inspect ? model.columns.find((col) => col.key === inspect.column) : undefined;
  const inspectValue =
    inspectRow && inspectCol ? overlayValue(inspectRow, inspectCol.key) : undefined;
  const inspectEditable =
    inspectRow !== undefined &&
    inspectCol !== undefined &&
    !saving &&
    isCellEditable(inspectCol, inspectRow.cells[inspectCol.key]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden outline-none"
      data-slot="store-data-grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <div className="relative z-20 flex h-9 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/60 bg-muted/15 px-2">
        {toolbarExtras}
        {toolbarExtras ? (
          <Separator orientation="vertical" className="mx-0.5 my-2 h-4 self-center" />
        ) : null}
        <div
          className="relative min-w-40 flex-1"
          title={indexMode ? "Search this index (Ctrl+F)" : "Find in this page (Ctrl+F)"}
        >
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={findRef}
            value={findValue}
            onChange={(e) =>
              indexMode ? indexSearch.onChange(e.target.value) : setFindText(e.target.value)
            }
            placeholder={
              indexMode ? "Find by title or id — or paste 1, 0, 0" : "Find in results…"
            }
            aria-label={indexMode ? "Search this index" : "Find in results"}
            data-slot={indexMode ? "index-search" : "grid-find"}
            className="h-6 border-0 bg-transparent pl-7 text-[11px] shadow-none focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0 md:text-[11px] dark:bg-transparent"
          />
        </div>
        {indexMode ? (
          <div className="flex items-center gap-1 text-[11px]" title="Hits to return">
            <span className="text-muted-foreground">topK</span>
            <Input
              type="number"
              min={1}
              max={100}
              aria-label="topK"
              data-slot="index-topk"
              className="h-6 w-10 border-0 bg-transparent px-1 text-center font-mono text-[11px] tabular-nums shadow-none focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0 md:text-[11px] dark:bg-transparent"
              value={indexSearch.topK}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 100) indexSearch.onTopKChange(n);
              }}
            />
          </div>
        ) : null}
        {sort ? (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
            data-slot="sort-indicator"
          >
            {sort.key} {sort.direction === "desc" ? "↓" : "↑"}
          </span>
        ) : null}

        <Separator orientation="vertical" className="mx-0.5 my-2 ml-auto h-4 self-center" />
        <div className="flex items-center gap-0.5">
          {canInlineEdit && facet === "kv" ? (
            <GridIconButton
              label="Add key"
              disabled={saving}
              onClick={() => setAddOpen(true)}
              slot="add-kv-key"
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" aria-hidden />
            </GridIconButton>
          ) : null}
          {canInlineEdit ? (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".csv,.tsv,.txt,.json,text/csv,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={onImportFile}
              />
              <GridIconButton
                label="Import CSV or JSON"
                disabled={saving}
                onClick={() => importRef.current?.click()}
                slot="import-rows"
              >
                <HugeiconsIcon icon={FileImportIcon} className="size-3.5" aria-hidden />
              </GridIconButton>
            </>
          ) : null}
          <DropdownMenu>
            <ToolbarTip
              label={
                selected.length > 0
                  ? `Export ${selected.length} selected row${selected.length === 1 ? "" : "s"}`
                  : "Export this page as CSV or JSON"
              }
            >
              <DropdownMenuTrigger
                disabled={viewRows.length === 0}
                render={(props) => (
                  <Button
                    {...props}
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={viewRows.length === 0}
                    aria-label="Export rows"
                    data-slot="export-rows"
                  >
                    <HugeiconsIcon icon={FileExportIcon} className="size-3.5" aria-hidden />
                  </Button>
                )}
              />
            </ToolbarTip>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {selected.length > 0 ? "Export selection" : "Export page"}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportRows("csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRows("json")}>JSON</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {canInlineEdit ? (
            <>
              {pending.size > 0 ? (
                <GridIconButton
                  label="Discard uncommitted changes"
                  disabled={saving}
                  onClick={discardPending}
                  slot="discard-changes"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
                </GridIconButton>
              ) : null}
              <ToolbarTip
                label={
                  pending.size > 0
                    ? `Review ${pending.size} uncommitted change${pending.size === 1 ? "" : "s"}`
                    : "No uncommitted changes"
                }
              >
                <Button
                  type="button"
                  variant={pending.size > 0 ? "outline" : "ghost"}
                  size="xs"
                  disabled={pending.size === 0 || saving}
                  onClick={openChanges}
                  aria-label={
                    pending.size > 0
                      ? `Review ${pending.size} uncommitted changes`
                      : "Review changes"
                  }
                  data-slot="apply-changes"
                  className={
                    pending.size > 0
                      ? "relative h-6 gap-1 overflow-visible border-amber-500/25 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300"
                      : "h-6"
                  }
                >
                  {pending.size > 0 ? (
                    <span
                      aria-hidden
                      className="oke-changes-border-run pointer-events-none absolute inset-0"
                    />
                  ) : null}
                  <HugeiconsIcon icon={Tick02Icon} className="relative size-3.5" aria-hidden />
                  <span className="relative">Changes</span>
                  {pending.size > 0 ? (
                    <span className="relative min-w-3.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-1 font-mono text-[9px] leading-3">
                      {pending.size}
                    </span>
                  ) : null}
                </Button>
              </ToolbarTip>
            </>
          ) : null}
          <GridIconButton
            label="Undo edit"
            shortcut="Ctrl+Z"
            disabled={(pending.size === 0 && history.past.length === 0) || saving}
            onClick={onUndo}
            slot="undo-edit"
          >
            <HugeiconsIcon icon={Undo02Icon} className="size-3.5" aria-hidden />
          </GridIconButton>
          <GridIconButton
            label="Redo edit"
            shortcut="Ctrl+Shift+Z"
            disabled={history.future.length === 0 || saving || pending.size > 0}
            onClick={onRedo}
            slot="redo-edit"
          >
            <HugeiconsIcon icon={Redo02Icon} className="size-3.5" aria-hidden />
          </GridIconButton>

          <DropdownMenu>
            <ToolbarTip label="Row height and columns">
              <DropdownMenuTrigger
                render={(props) => (
                  <Button
                    {...props}
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="View options"
                    data-slot="view-menu"
                  >
                    <HugeiconsIcon icon={ViewIcon} className="size-3.5" aria-hidden />
                  </Button>
                )}
              />
            </ToolbarTip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Row height</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={rowHeight}
                  onValueChange={(value) => setRowHeight(value as RowHeight)}
                >
                  <DropdownMenuRadioItem value="short" data-slot="row-height-menu">
                    Short
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="tall">Tall</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="extra-tall">Extra tall</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {model.columns.map((col) => {
                  const visible = !hiddenCols.has(col.key);
                  const lastVisible = visible && visibleColumns.length === 1;
                  return (
                    <DropdownMenuCheckboxItem
                      key={col.key}
                      checked={visible}
                      disabled={lastVisible}
                      onCheckedChange={(checked) => {
                        setHiddenCols((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(col.key);
                          else next.add(col.key);
                          return next;
                        });
                      }}
                    >
                      <span className="font-mono text-[11px]">{col.label ?? col.key}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {model.editable && onDeleteRows ? (
            <ToolbarTip
              label={
                selectedRows.length > 0
                  ? `Delete ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"}`
                  : "Select rows to delete"
              }
            >
              <Button
                type="button"
                variant="destructive"
                size={selectedRows.length > 0 ? "xs" : "icon-xs"}
                className={selectedRows.length > 0 ? "ml-1 h-6" : "ml-1"}
                disabled={selectedRows.length === 0}
                onClick={() => onDeleteRows(selectedRows)}
                aria-label={
                  selectedRows.length > 0
                    ? `Delete ${selectedRows.length} selected rows`
                    : "Delete selected rows"
                }
                data-slot="delete-selected"
              >
                <HugeiconsIcon icon={Delete02Icon} className="size-3.5" aria-hidden />
                {selectedRows.length > 0 ? selectedRows.length : null}
              </Button>
            </ToolbarTip>
          ) : null}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1"
        data-slot="grid-viewport"
        aria-label={`${childName} rows`}
      >
        <Table
          data={viewRows}
          columns={tableColumns}
          getRowId={(row) => row.id}
          selectable={hasSelect}
          selectedRowIds={selected}
          onSelectionChange={setSelected}
          sort={sort}
          onSortChange={setSort}
          resizable
          reorderable
          onCellEdit={canInlineEdit ? onCellEdit : undefined}
          onDeleteRow={
            model.editable && onDeleteRows
              ? (rowId) => {
                  const row = model.rows.find((r) => r.id === rowId);
                  if (row) onDeleteRows([row]);
                }
              : undefined
          }
          cellRange={cellRange}
          onCellRangeChange={
            canInlineEdit
              ? (range) => {
                  setCellRange(range);
                  if (!range) return;
                  const row = viewRows[range.head.row];
                  const col = visibleColumns[range.head.col];
                  if (row && col) setLastFocus({ rowId: row.id, key: col.key });
                  const root = viewportRef.current?.closest("[data-slot='store-data-grid']");
                  if (
                    root instanceof HTMLElement &&
                    !(document.activeElement instanceof HTMLInputElement)
                  ) {
                    root.focus({ preventScroll: true });
                  }
                }
              : undefined
          }
          onCellActivate={
            canInlineEdit
              ? (row, col) => {
                  const r = viewRows[row];
                  const c = visibleColumns[col];
                  if (r && c) startEdit(r.id, c.key);
                }
              : undefined
          }
          rowHeight={rowHeightPx}
          height={viewportHeight}
          emptyState={
            indexMode && findValue.trim()
              ? "No hits — try a different query or raise topK."
              : findText.trim()
                ? "No matches on this page — increase Limit to search more rows."
                : "No rows."
          }
          className="h-full rounded-none border-0"
        />
      </div>

      {canInlineEdit ? (
        <PendingChangesSheet
          open={changesOpen}
          onOpenChange={setChangesOpen}
          pending={pending}
          table={childName}
          facet={facet === "kv" ? "kv" : "sql"}
          saving={saving}
          error={editError}
          onUndoCell={undoPendingCell}
          onClearAll={discardPending}
          onCommitAll={applyPending}
        />
      ) : null}

      {canInlineEdit && facet === "sql" && onInsertOpenChange ? (
        <SqlInsertSheet
          open={insertOpen}
          onOpenChange={onInsertOpenChange}
          storeRef={storeRef}
          childName={childName}
          tenant={tenant}
          columns={model.columns}
        />
      ) : null}

      {canInlineEdit && facet === "kv" ? (
        <KvAddSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          storeRef={storeRef}
          childName={childName}
          tenant={tenant}
          existingKeys={model.rows.map((row) => row.id)}
        />
      ) : null}

      {inspect && inspectRow && inspectCol ? (
        <JsonValueSheet
          open
          onOpenChange={(open) => {
            if (!open) setInspect(null);
          }}
          rowId={inspect.rowId}
          column={inspect.column}
          storeRef={storeRef}
          value={inspectValue}
          originalValue={inspectRow.cells[inspectCol.key]}
          editable={inspectEditable}
          onChange={
            inspectEditable
              ? (next) => stageRawCell(inspect.rowId, inspect.column, next)
              : undefined
          }
        />
      ) : null}

      <div
        className="flex h-7 shrink-0 items-center gap-2 border-t border-border/50 bg-muted/15 px-2.5 font-mono text-[10px] text-muted-foreground"
        data-slot="grid-status"
      >
        <span>
          {filteredRows.length}
          {filteredRows.length !== model.rows.length ? ` of ${model.rows.length}` : ""}{" "}
          {model.rows.length === 1 ? "row" : "rows"}
        </span>
        {routedRole ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span>{routedRole}</span>
          </>
        ) : null}
        {facet === "sql" && masked ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="text-sky-700 dark:text-sky-400">PII masked</span>
          </>
        ) : facet === "sql" && model.columns.some((col) => col.pii) ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="text-amber-800 dark:text-amber-300">PII visible</span>
          </>
        ) : null}
        {pending.size > 0 ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span
              className="text-amber-800 dark:text-amber-300"
              role="status"
              data-slot="pending-count"
            >
              {pending.size} uncommitted
            </span>
          </>
        ) : null}
        {saving ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span role="status" data-slot="cell-edit-saving">
              Saving…
            </span>
          </>
        ) : null}
        {notice ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span role="status" data-slot="grid-notice">
              {notice}
            </span>
          </>
        ) : null}
        {editError ? (
          <span className="text-destructive" role="alert" data-slot="cell-edit-error">
            {editError}
          </span>
        ) : null}
        {indexMode && findValue.trim() ? (
          <span className="ml-auto truncate" role="status" data-slot="find-scope">
            Index query · topK {indexSearch.topK}
          </span>
        ) : findText.trim() ? (
          <span className="ml-auto truncate" role="status" data-slot="find-scope">
            This page only · limit {limit}
          </span>
        ) : selectedRows.length > 0 ? (
          <span className="ml-auto">
            {selectedRows.length} row{selectedRows.length === 1 ? "" : "s"} checked
          </span>
        ) : (
          <span className="ml-auto opacity-60">
            Click to select · drag a range · click again or type to edit · Changes to review
          </span>
        )}
      </div>
    </div>
  );
}

/** Header label with type / PK / PII glyphs. */
function StoreColumnHeader({ col }: { readonly col: StoreGridColumn }): JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={col.description ?? col.key}>
      {col.type !== "string" ? (
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground/50">
          {typeGlyph(col.type)}
        </span>
      ) : null}
      {col.primaryKey ? (
        <HugeiconsIcon
          icon={Key01Icon}
          className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
          aria-label="Primary key"
        />
      ) : null}
      {col.pii ? (
        <HugeiconsIcon
          icon={SecurityCheckIcon}
          className="size-3 shrink-0 text-sky-600 dark:text-sky-400"
          aria-label="PII column"
        />
      ) : null}
      <span className="truncate font-mono text-[11px]">{col.label ?? col.key}</span>
    </span>
  );
}

/** Dirty fill lives on the `td`; this is only the tan pending text. */
const DIRTY_TEXT = "text-[#9a5b12] dark:text-[#e8c48a]";

/** Stretch the cell chrome to the td edges so pending/selection fills the row. */
const CELL_FILL =
  "absolute inset-0 flex min-w-0 items-center overflow-hidden px-4 font-mono text-[11px]";

/** Body cell: Reveal for masked PII, EditableCell when writable, otherwise formatted text. */
function StoreGridBodyCell({
  row,
  col,
  storeRef,
  childName,
  tenant,
  masked,
  editable,
  saving,
  dirty,
  editing,
  draftSeed,
  displayValue,
  onFocus,
  onStartEdit,
  onEditEnd,
  onCommit,
  onInspect,
  onUpgrade,
}: {
  readonly row: StoreGridRow;
  readonly col: StoreGridColumn;
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly masked: boolean;
  readonly editable: boolean;
  readonly saving: boolean;
  readonly dirty: boolean;
  readonly editing: boolean;
  readonly draftSeed: string | null;
  readonly displayValue: unknown;
  readonly onFocus: () => void;
  readonly onStartEdit: () => void;
  readonly onEditEnd: () => void;
  readonly onCommit: (next: string) => void;
  readonly onInspect: () => void;
  readonly onUpgrade?: () => void;
}): JSX.Element {
  const value = displayValue;
  const numeric = isNumericType(col.type);
  const isNull = value === null || value === undefined;

  if (col.pii && masked && isStorePiiMask(row.cells[col.key]) && !dirty) {
    return (
      <span className={CELL_FILL}>
        <RevealCell
          refName={storeRef}
          child={childName}
          {...(tenant ? { tenant } : {})}
          rowId={row.id}
          column={col.key}
          maskedValue={row.cells[col.key]}
        />
      </span>
    );
  }

  if (col.type === "boolean") {
    const checked = displayValue === true;
    return (
      <span
        className={cn(CELL_FILL, "justify-center", dirty && DIRTY_TEXT)}
        data-slot={editable ? "cell-display" : undefined}
        data-pending={dirty ? "true" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <Switch
          size="sm"
          checked={checked}
          disabled={!editable || saving}
          ariaLabel={checked ? `Disable ${row.id}` : `Enable ${row.id}`}
          onCheckedChange={(next) => {
            if (editable && !saving) onCommit(next ? "true" : "false");
          }}
        />
      </span>
    );
  }

  if (editable && editing) {
    return (
      <span
        className={cn(CELL_FILL, dirty && DIRTY_TEXT, numeric && "tabular-nums")}
        data-slot="cell-editor"
        data-pending={dirty ? "true" : undefined}
      >
        <EditableCell
          value={draftSeed ?? cellDraftText(col, value)}
          label={`Edit ${col.key}`}
          dirty={dirty}
          autoFocus
          placeholder={col.format === "ttl" ? "30m" : undefined}
          onFocus={onFocus}
          onIdle={onEditEnd}
          onChange={(next) => {
            if (!saving) onCommit(next);
          }}
          className={cn(
            "h-full min-w-0 font-mono text-[11px]",
            numeric && "text-right tabular-nums",
            isRtlText(value) && "text-right",
          )}
        />
      </span>
    );
  }

  const inspectable = asInspectableJson(value) !== null;
  const text = formatStoreCell(col, value);

  return (
    <span
      role={editable ? "button" : undefined}
      tabIndex={editable ? -1 : undefined}
      data-slot={editable ? "cell-display" : undefined}
      data-pending={dirty ? "true" : undefined}
      className={cn(
        CELL_FILL,
        "group/cell gap-1",
        editable && "cursor-cell",
        dirty && DIRTY_TEXT,
        numeric && "tabular-nums",
        isNull && !dirty && "text-muted-foreground/40",
        col.type === "json" && !isNull && !dirty && "text-muted-foreground",
      )}
      title={col.format === "name-key" && typeof row.cells.url === "string" ? row.cells.url : text}
      onDoubleClick={
        editable
          ? (event) => {
              event.stopPropagation();
              if (!saving) onStartEdit();
            }
          : undefined
      }
    >
      {col.format === "source" ? (
        <SourceBadge value={text} />
      ) : col.format === "name-key" ? (
        <ExtensionTitle
          title={text}
          url={typeof row.cells.url === "string" ? row.cells.url : null}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" dir={isRtlText(value) ? "rtl" : "ltr"}>
          {text}
        </span>
      )}
      {col.format === "name-key" ? (
        <ExtensionIdChip
          name={typeof row.cells.name === "string" ? row.cells.name : ""}
          version={row.cells.version != null ? String(row.cells.version) : ""}
          available={row.cells.available != null ? String(row.cells.available) : ""}
          upgradeable={row.cells.upgrade === true}
          saving={saving}
          onUpgrade={onUpgrade}
        />
      ) : null}
      {inspectable ? <JsonInspectButton onInspect={onInspect} /> : null}
    </span>
  );
}

function ExtensionTitle({
  title,
  url,
}: {
  readonly title: string;
  readonly url: string | null;
}): JSX.Element {
  if (!url) {
    return <span className="min-w-0 flex-1 truncate">{title}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group/ext-link inline-flex min-w-0 flex-1 items-center gap-1 truncate text-foreground underline-offset-2 hover:underline"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="truncate">{title}</span>
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        className="size-3 shrink-0 text-muted-foreground/50 group-hover/ext-link:text-muted-foreground"
        aria-hidden
      />
    </a>
  );
}

function ExtensionIdChip({
  name,
  version,
  available,
  upgradeable,
  saving,
  onUpgrade,
}: {
  readonly name: string;
  readonly version: string;
  readonly available: string;
  readonly upgradeable: boolean;
  readonly saving: boolean;
  readonly onUpgrade?: () => void;
}): JSX.Element | null {
  if (!name && !version) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-stretch overflow-hidden rounded-md border border-border/60 bg-muted/25 font-mono text-[9px] leading-none">
      {name ? (
        <span className="inline-flex items-center px-1.5 text-muted-foreground">{name}</span>
      ) : null}
      {name && version ? <span className="w-px self-stretch bg-border/60" aria-hidden /> : null}
      {version ? (
        <span className="inline-flex items-center bg-amber-500/10 px-1.5 font-semibold tabular-nums text-amber-800 dark:text-amber-300">
          v{version}
        </span>
      ) : null}
      {upgradeable && available && onUpgrade ? (
        <>
          <span className="w-px self-stretch bg-border/60" aria-hidden />
          <button
            type="button"
            disabled={saving}
            title={`Upgrade to ${available}`}
            aria-label={`Upgrade ${name} from ${version} to ${available}`}
            className="inline-flex items-center bg-emerald-500/15 px-1.5 font-semibold tracking-wide text-emerald-800 uppercase hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-300"
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (!saving) onUpgrade();
            }}
          >
            Upgrade
          </button>
        </>
      ) : null}
    </span>
  );
}

function SourceBadge({ value }: { readonly value: string }): JSX.Element {
  const library = value === "library";
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 gap-1 rounded-md px-1.5 font-mono text-[9px] font-semibold tracking-wide uppercase",
        library
          ? "border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-300"
          : "border-border/60 bg-muted/40 text-muted-foreground",
      )}
    >
      <HugeiconsIcon icon={library ? PuzzleIcon : Database01Icon} className="size-3" aria-hidden />
      {library ? "Library" : "Builtin"}
    </Badge>
  );
}

/** Trailing affordance that opens the JSON inspect sheet without starting an edit. */
function JsonInspectButton({ onInspect }: { readonly onInspect: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Open as table"
            data-slot="json-inspect"
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/40",
              "group-hover/cell:text-muted-foreground hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
            onPointerDown={(event) => {
              event.stopPropagation();
              props.onPointerDown?.(event);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick?.(event);
              onInspect();
            }}
          >
            <HugeiconsIcon icon={LeftToRightListBulletIcon} className="size-3" aria-hidden />
          </button>
        )}
      />
      <TooltipContent side="left" className="text-[11px]">
        Open as table
      </TooltipContent>
    </Tooltip>
  );
}

/** Trigger a browser download for a UTF-8 text payload. */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Icon-only toolbar control with a tooltip. */
function GridIconButton({
  label,
  shortcut,
  disabled,
  onClick,
  slot,
  children,
}: {
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly slot: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={(event) => {
              props.onClick?.(event);
              onClick();
            }}
            data-slot={slot}
          >
            {children}
          </Button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  );
}
