/**
 * Purpose-fit Store data grid — TanStack Table + Virtual, DiceUI-grade
 * spreadsheet interactions on top of the real console store API.
 *
 * Advanced features: multi-cell selection (Shift/Ctrl+Click, Shift+Arrows,
 * Ctrl+A), clipboard copy/cut/paste (TSV), Delete-to-clear, type-to-edit,
 * F2/Enter/Tab edit navigation, undo/redo via inverse patches, row heights,
 * column visibility, right-click context menu, and a Ctrl+/ shortcuts sheet.
 * Header and body rows share one explicit grid template so columns align.
 */

import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  ClipboardIcon,
  Copy01Icon,
  Delete02Icon,
  Key01Icon,
  KeyboardIcon,
  PencilEdit01Icon,
  Redo02Icon,
  Scissor01Icon,
  Search01Icon,
  Undo02Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStoreEdit } from "../data/use-store-edit.ts";
import { RevealCell } from "../detail/reveal-cell.tsx";
import {
  clampCoord,
  coordKey,
  matrixToTsv,
  parseCoordKey,
  rangeArea,
  rangeContains,
  rangeCoords,
  stepCoord,
  tsvToMatrix,
  type CellCoord,
  type CellRange,
} from "../lib/cell-selection.ts";
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
  type StoreGridColumn,
  type StoreGridModel,
  type StoreGridRow,
} from "../lib/grid-model.ts";
import { isStorePiiMask, parseStoreCellDraft, sanitizeStorePatch } from "../lib/patch.ts";
import { isRtlText } from "../lib/rtl.ts";
import { StoreGridContextMenu, type StoreGridMenuItem } from "./store-grid-context-menu.tsx";
import { StoreGridShortcuts } from "./store-grid-shortcuts.tsx";

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
  /** Open the row detail Sheet (double-click on non-editable cells). */
  readonly onOpenRow?: (row: StoreGridRow) => void;
  readonly onDeleteRows?: (rows: readonly StoreGridRow[]) => void;
}

/** Active inline-edit target plus its pristine draft for change detection. */
interface EditingCell extends CellCoord {
  readonly rowId: string;
  readonly key: string;
  readonly initial: string;
  readonly prev: unknown;
}

/** Row height presets (px) for the height menu. */
const ROW_HEIGHTS = { short: 26, medium: 34, tall: 44, "extra-tall": 56 } as const;
type RowHeight = keyof typeof ROW_HEIGHTS;

/** Fixed column width (rem) by cell variant — shared by header + body. */
function columnWidthRem(type: StoreGridModel["columns"][number]["type"], key: string): number {
  if (key === "id" || key === "key") return 12;
  switch (type) {
    case "integer":
    case "number":
      return 7;
    case "json":
      return 18;
    default:
      return 14;
  }
}

/** Tiny muted type glyph for the header (quiet alternative to pills). */
function typeGlyph(type: StoreGridModel["columns"][number]["type"]): string {
  switch (type) {
    case "integer":
    case "number":
      return "123";
    case "json":
      return "{ }";
    default:
      return "abc";
  }
}

/** Serialize a raw cell value into the inline editor's draft text. */
function cellDraftText(col: StoreGridColumn, raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (col.type === "json") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return String(raw);
}

/**
 * Virtualized data grid for Store browse results.
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
  onOpenRow,
  onDeleteRows,
}: StoreDataGridProps): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [findText, setFindText] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<CellCoord | null>(null);
  const [selHead, setSelHead] = useState<CellCoord | null>(null);
  const [selExtra, setSelExtra] = useState<ReadonlySet<string>>(new Set());
  const [cutKeys, setCutKeys] = useState<ReadonlySet<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(new Set());
  const [rowHeight, setRowHeight] = useState<RowHeight>("medium");
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistory>(EMPTY_EDIT_HISTORY);
  const [menu, setMenu] = useState<{ x: number; y: number; coord: CellCoord } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [saving, setSaving] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const edit = useStoreEdit();

  const hasSelect = onDeleteRows !== undefined;
  const canInlineEdit = model.editable && (facet === "sql" || facet === "kv");
  const rowHeightPx = ROW_HEIGHTS[rowHeight];

  const visibleColumns = useMemo(
    () => model.columns.filter((c) => !hiddenCols.has(c.key)),
    [model.columns, hiddenCols],
  );

  const { gridTemplate, gridWidth } = useMemo(() => {
    const cols = visibleColumns.map((c) => `${columnWidthRem(c.type, c.key)}rem`);
    if (hasSelect) cols.unshift("2rem");
    const total =
      visibleColumns.reduce((sum, c) => sum + columnWidthRem(c.type, c.key), 0) +
      (hasSelect ? 2 : 0);
    return { gridTemplate: cols.join(" "), gridWidth: total };
  }, [visibleColumns, hasSelect]);

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: gridTemplate,
    width: `max(100%, ${gridWidth}rem)`,
  } as const;

  const columns = useMemo<ColumnDef<StoreGridRow>[]>(
    () =>
      model.columns.map((col) => ({
        id: col.key,
        accessorFn: (row) => row.cells[col.key],
        header: col.key,
        cell: (info) => info.getValue(),
        meta: { column: col },
      })),
    [model.columns],
  );

  const filteredRows = useMemo(() => {
    if (!findText.trim()) return model.rows;
    const q = findText.trim().toLowerCase();
    return model.rows.filter((row) =>
      Object.values(row.cells).some((v) => formatGridCell(v).toLowerCase().includes(q)),
    );
  }, [model.rows, findText]);

  const table = useReactTable({
    data: filteredRows as StoreGridRow[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const { rows } = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeightPx,
    overscan: 8,
  });

  const maxRow = rows.length - 1;
  const maxCol = visibleColumns.length - 1;

  // Reset everything when the browse context (store/child/tenant/facet) changes.
  useEffect(() => {
    setSelected(new Set());
    setFocused(null);
    setSelHead(null);
    setSelExtra(new Set());
    setCutKeys(new Set());
    setHiddenCols(new Set());
    setEditing(null);
    setEditError(null);
    setHistory(EMPTY_EDIT_HISTORY);
    setSorting([]);
    setFindText("");
  }, [facet, storeRef, childName, tenant]);

  // Index-based cell selection is invalid after re-sorting or re-filtering.
  useEffect(() => {
    setSelHead(null);
    setSelExtra(new Set());
    setCutKeys(new Set());
  }, [sorting, findText]);

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---------- row selection (delete) ----------

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };

  const selectedRows = useMemo(
    () => model.rows.filter((r) => selected.has(r.id)),
    [model.rows, selected],
  );

  // ---------- cell selection ----------

  const range: CellRange | null = focused && selHead ? { anchor: focused, head: selHead } : null;

  const isCellSelected = (row: number, col: number): boolean =>
    (range !== null && rangeContains(range, row, col)) || selExtra.has(coordKey(row, col));

  const selectedCellCount = range ? rangeArea(range) : selExtra.size;

  const clearCellSelection = () => {
    setSelHead(null);
    setSelExtra(new Set());
    setCutKeys(new Set());
  };

  const moveFocus = (next: CellCoord, opts?: { extend?: boolean }) => {
    const clamped = clampCoord(next, maxRow, maxCol);
    if (opts?.extend) {
      setSelHead(clamped);
      setSelExtra(new Set());
    } else {
      setFocused(clamped);
      setSelHead(null);
      setSelExtra(new Set());
    }
    virtualizer.scrollToIndex(clamped.row);
  };

  const selectAllCells = () => {
    if (rows.length === 0 || visibleColumns.length === 0) return;
    setFocused({ row: 0, col: 0 });
    setSelHead({ row: maxRow, col: maxCol });
    setSelExtra(new Set());
  };

  const cellValueAt = (coord: CellCoord): unknown => {
    const col = visibleColumns[coord.col];
    if (!col) return undefined;
    return rows[coord.row]?.original.cells[col.key];
  };

  /** Coordinates covered by the current selection (range, extras, or focus). */
  const gatherCoords = (): CellCoord[] => {
    if (range) return rangeCoords(range);
    if (selExtra.size > 0) {
      return [...selExtra]
        .map(parseCoordKey)
        .filter((c): c is CellCoord => c !== null)
        .sort((a, b) => a.row - b.row || a.col - b.col);
    }
    return focused ? [focused] : [];
  };

  // ---------- clipboard ----------

  const copySelection = async (cut: boolean) => {
    const coords = gatherCoords();
    if (coords.length === 0) return;
    const byRow = new Map<number, string[]>();
    for (const coord of coords) {
      const line = byRow.get(coord.row) ?? [];
      line[coord.col] = formatGridCell(cellValueAt(coord));
      byRow.set(coord.row, line);
    }
    const width = Math.max(...[...byRow.values()].map((l) => l.length));
    const matrix = [...byRow.values()].map((l) =>
      Array.from({ length: width }, (_, i) => l[i] ?? ""),
    );
    try {
      await navigator.clipboard.writeText(matrixToTsv(matrix));
      setNotice(`${cut ? "Cut" : "Copied"} ${coords.length} cell(s)`);
      setCutKeys(cut ? new Set(coords.map((c) => coordKey(c.row, c.col))) : new Set());
    } catch {
      setEditError("Clipboard write blocked — allow clipboard access in the browser prompt.");
    }
  };

  // ---------- commits ----------

  const isCellEditable = (col: StoreGridColumn | undefined, raw: unknown): boolean =>
    canInlineEdit &&
    col !== undefined &&
    col.editable &&
    !(col.pii && masked && isStorePiiMask(raw));

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

  const pasteAtFocused = async () => {
    if (!focused || !canInlineEdit || saving) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setEditError("Clipboard read blocked — allow clipboard access in the browser prompt.");
      return;
    }
    const matrix = tsvToMatrix(text);
    if (matrix.length === 0) return;
    const updates: CellUpdate[] = [];
    for (const [r, line] of matrix.entries()) {
      for (const [c, cellText] of line.entries()) {
        const coord = { row: focused.row + r, col: focused.col + c };
        if (coord.row > maxRow || coord.col > maxCol) continue;
        const rowObj = rows[coord.row];
        const col = visibleColumns[coord.col];
        if (!rowObj || !col) continue;
        const raw = rowObj.original.cells[col.key];
        if (!isCellEditable(col, raw)) continue;
        const next = cellText === "" ? null : parseStoreCellDraft(col.type, cellText);
        if (Object.is(raw, next)) continue;
        updates.push({ rowId: rowObj.id, key: col.key, prev: raw, next });
      }
    }
    // Cut-move: clear the sources in the same batch so undo is atomic.
    for (const key of cutKeys) {
      const coord = parseCoordKey(key);
      if (!coord) continue;
      const rowObj = rows[coord.row];
      const col = visibleColumns[coord.col];
      if (!rowObj || !col) continue;
      const raw = rowObj.original.cells[col.key];
      if (!isCellEditable(col, raw) || raw === null || raw === undefined) continue;
      if (updates.some((u) => u.rowId === rowObj.id && u.key === col.key)) continue;
      updates.push({ rowId: rowObj.id, key: col.key, prev: raw, next: null });
    }
    if (updates.length === 0) {
      setCutKeys(new Set());
      return;
    }
    const ok = await commitBatch(updates, { notice: `Pasted ${updates.length} cell(s)` });
    if (ok) setCutKeys(new Set());
  };

  const clearSelectedCells = () => {
    if (!canInlineEdit || saving) return;
    const updates: CellUpdate[] = [];
    for (const coord of gatherCoords()) {
      const rowObj = rows[coord.row];
      const col = visibleColumns[coord.col];
      if (!rowObj || !col) continue;
      const raw = rowObj.original.cells[col.key];
      if (!isCellEditable(col, raw) || raw === null || raw === undefined) continue;
      updates.push({ rowId: rowObj.id, key: col.key, prev: raw, next: null });
    }
    if (updates.length > 0) {
      void commitBatch(updates, { notice: `Cleared ${updates.length} cell(s)` });
    }
  };

  // ---------- undo / redo ----------

  const onUndo = () => {
    if (saving) return;
    const { history: next, batch } = popUndo(history);
    if (!batch) return;
    setHistory(next);
    void commitBatch(invertEditBatch(batch).updates, {
      track: false,
      notice: `Undid ${batch.updates.length} cell(s)`,
    });
  };

  const onRedo = () => {
    if (saving) return;
    const { history: next, batch } = popRedo(history);
    if (!batch) return;
    setHistory(next);
    void commitBatch(batch.updates, {
      track: false,
      notice: `Redid ${batch.updates.length} cell(s)`,
    });
  };

  // ---------- inline editing ----------

  const startEdit = (
    row: StoreGridRow,
    col: StoreGridColumn,
    coord: CellCoord,
    initialOverride?: string,
  ) => {
    const raw = row.cells[col.key];
    if (!isCellEditable(col, raw)) return;
    const initial = initialOverride ?? cellDraftText(col, raw);
    setEditing({ rowId: row.id, key: col.key, row: coord.row, col: coord.col, initial, prev: raw });
    setDraft(initial);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const commitEdit = (moveTo?: CellCoord) => {
    if (!editing || saving) return;
    const finish = () => {
      cancelEdit();
      if (moveTo) moveFocus(moveTo);
    };
    if (draft === editing.initial) {
      finish();
      return;
    }
    const col = model.columns.find((c) => c.key === editing.key);
    if (!col) {
      finish();
      return;
    }
    const next = draft.trim() === "" ? null : parseStoreCellDraft(col.type, draft);
    if (Object.is(next, editing.prev)) {
      finish();
      return;
    }
    void commitBatch([{ rowId: editing.rowId, key: editing.key, prev: editing.prev, next }]);
    finish();
  };

  // ---------- keyboard ----------

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (menu) setMenu(null);
    const meta = event.ctrlKey || event.metaKey;

    if (event.key === "Escape") {
      if (editing) cancelEdit();
      else if (range || selExtra.size > 0) clearCellSelection();
      else {
        setCutKeys(new Set());
        setFocused(null);
      }
      return;
    }
    if (editing) return;

    if (meta && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findRef.current?.focus();
      return;
    }
    if (meta && event.key === "/") {
      event.preventDefault();
      setShowShortcuts((v) => !v);
      return;
    }
    if (meta && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllCells();
      return;
    }
    if (meta && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection(false);
      return;
    }
    if (meta && event.key.toLowerCase() === "x") {
      event.preventDefault();
      void copySelection(true);
      return;
    }
    if (meta && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void pasteAtFocused();
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

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (meta) {
        if (onDeleteRows && selectedRows.length > 0) onDeleteRows(selectedRows);
      } else {
        clearSelectedCells();
      }
      return;
    }

    if (!focused) {
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        moveFocus({ row: 0, col: 0 });
      }
      return;
    }

    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const delta: Record<string, CellCoord> = {
        ArrowDown: { row: 1, col: 0 },
        ArrowUp: { row: -1, col: 0 },
        ArrowLeft: { row: 0, col: -1 },
        ArrowRight: { row: 0, col: 1 },
      };
      const d = delta[event.key];
      if (!d) return;
      const target = meta
        ? {
            row: d.row === 0 ? focused.row : d.row > 0 ? maxRow : 0,
            col: d.col === 0 ? focused.col : d.col > 0 ? maxCol : 0,
          }
        : { row: focused.row + d.row, col: focused.col + d.col };
      moveFocus(target, { extend: event.shiftKey });
      return;
    }

    switch (event.key) {
      case "Home":
        event.preventDefault();
        moveFocus({ row: meta ? 0 : focused.row, col: 0 }, { extend: event.shiftKey });
        return;
      case "End":
        event.preventDefault();
        moveFocus({ row: meta ? maxRow : focused.row, col: maxCol }, { extend: event.shiftKey });
        return;
      case "PageDown":
      case "PageUp": {
        event.preventDefault();
        const page = Math.max(
          1,
          Math.floor((parentRef.current?.clientHeight ?? 300) / rowHeightPx) - 1,
        );
        moveFocus(
          { row: focused.row + (event.key === "PageDown" ? page : -page), col: focused.col },
          { extend: event.shiftKey },
        );
        return;
      }
      case "Tab":
        event.preventDefault();
        moveFocus(stepCoord(focused, event.shiftKey ? -1 : 1, maxRow, maxCol));
        return;
      case "Enter":
      case "F2": {
        event.preventDefault();
        const rowObj = rows[focused.row];
        const col = visibleColumns[focused.col];
        if (rowObj && col) {
          if (isCellEditable(col, rowObj.original.cells[col.key])) {
            startEdit(rowObj.original, col, focused);
          } else {
            onOpenRow?.(rowObj.original);
          }
        }
        return;
      }
      default:
        // Type-to-edit: any printable character replaces the cell contents.
        if (event.key.length === 1 && !meta && !event.altKey) {
          const rowObj = rows[focused.row];
          const col = visibleColumns[focused.col];
          if (rowObj && col && isCellEditable(col, rowObj.original.cells[col.key])) {
            event.preventDefault();
            startEdit(rowObj.original, col, focused, event.key);
          }
        }
    }
  };

  // ---------- context menu ----------

  const menuRow = menu ? rows[menu.coord.row] : undefined;
  const menuCol = menu ? visibleColumns[menu.coord.col] : undefined;
  const menuRaw = menuRow && menuCol ? menuRow.original.cells[menuCol.key] : undefined;

  const menuItems: readonly StoreGridMenuItem[] = menu
    ? [
        {
          label: "Copy",
          shortcut: "⌘C",
          icon: Copy01Icon,
          onSelect: () => void copySelection(false),
        },
        ...(canInlineEdit
          ? ([
              {
                label: "Cut",
                shortcut: "⌘X",
                icon: Scissor01Icon,
                onSelect: () => void copySelection(true),
              },
              {
                label: "Paste",
                shortcut: "⌘V",
                icon: ClipboardIcon,
                onSelect: () => void pasteAtFocused(),
              },
              {
                label: "Clear",
                shortcut: "Del",
                icon: Delete02Icon,
                onSelect: clearSelectedCells,
              },
            ] satisfies StoreGridMenuItem[])
          : []),
        ...(menuCol && isCellEditable(menuCol, menuRaw)
          ? ([
              { type: "separator" },
              {
                label: "Edit cell",
                shortcut: "Enter",
                icon: PencilEdit01Icon,
                onSelect: () => {
                  if (menuRow && menuCol && menu) startEdit(menuRow.original, menuCol, menu.coord);
                },
              },
            ] satisfies StoreGridMenuItem[])
          : []),
        ...(onDeleteRows && menuRow
          ? ([
              { type: "separator" },
              {
                label:
                  selected.has(menuRow.id) && selectedRows.length > 1
                    ? `Delete ${selectedRows.length} rows`
                    : "Delete row",
                shortcut: "⌘⌫",
                icon: Delete02Icon,
                destructive: true,
                onSelect: () =>
                  onDeleteRows(
                    selected.has(menuRow.id) && selectedRows.length > 1
                      ? selectedRows
                      : [menuRow.original],
                  ),
              },
            ] satisfies StoreGridMenuItem[])
          : []),
      ]
    : [];

  // ---------- render ----------

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60"
      data-slot="store-data-grid"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-2 py-1.5">
        {toolbarExtras}
        <div className="relative w-52">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={findRef}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            placeholder="Find in results…"
            aria-label="Find in results"
            className="h-7 border-border/60 bg-transparent pl-7 font-mono text-[11px] shadow-none"
          />
        </div>
        {sorting.length > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
            data-slot="sort-indicator"
          >
            {sorting.map((s) => `${s.id} ${s.desc ? "↓" : "↑"}`).join(", ")}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Undo edit"
            title="Undo (Ctrl+Z)"
            disabled={history.past.length === 0 || saving}
            onClick={onUndo}
            data-slot="undo-edit"
          >
            <HugeiconsIcon icon={Undo02Icon} className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Redo edit"
            title="Redo (Ctrl+Shift+Z)"
            disabled={history.future.length === 0 || saving}
            onClick={onRedo}
            data-slot="redo-edit"
          >
            <HugeiconsIcon icon={Redo02Icon} className="size-3.5" aria-hidden />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button
                  {...props}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  data-slot="row-height-menu"
                >
                  <HugeiconsIcon icon={ArrowUpDownIcon} className="size-3.5" aria-hidden />
                  Height
                </Button>
              )}
            />
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>Row height</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={rowHeight}
                onValueChange={(value) => setRowHeight(value as RowHeight)}
              >
                <DropdownMenuRadioItem value="short">Short</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="tall">Tall</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="extra-tall">Extra tall</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button
                  {...props}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  data-slot="view-menu"
                >
                  <HugeiconsIcon icon={ViewIcon} className="size-3.5" aria-hidden />
                  Columns
                </Button>
              )}
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
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
                    <span className="font-mono text-[11px]">{col.key}</span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (Ctrl+/)"
            onClick={() => setShowShortcuts(true)}
            data-slot="grid-shortcuts"
          >
            <HugeiconsIcon icon={KeyboardIcon} className="size-3.5" aria-hidden />
          </Button>

          {model.editable && onDeleteRows ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7"
              disabled={selectedRows.length === 0}
              onClick={() => onDeleteRows(selectedRows)}
              data-slot="delete-selected"
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-3.5" aria-hidden />
              Delete{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={parentRef}
        role="grid"
        aria-label={`${childName} rows`}
        aria-rowcount={rows.length}
        aria-colcount={visibleColumns.length + (hasSelect ? 1 : 0)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
        data-slot="grid-viewport"
      >
        <div
          role="row"
          className="sticky top-0 z-10 border-b border-border/60 bg-muted/60 backdrop-blur"
          style={gridStyle}
        >
          {hasSelect ? (
            <div role="columnheader" className="flex h-8 items-center justify-center px-1">
              <input
                type="checkbox"
                aria-label="Select all rows"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                className="size-3.5 accent-primary"
              />
            </div>
          ) : null}
          {visibleColumns.map((col) => {
            const column = table.getColumn(col.key);
            const sorted = column?.getIsSorted();
            return (
              <div
                key={col.key}
                role="columnheader"
                className="flex h-8 items-center gap-1 overflow-hidden px-2.5"
                title={col.description}
              >
                {col.primaryKey ? (
                  <HugeiconsIcon
                    icon={Key01Icon}
                    className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-label="Primary key"
                  />
                ) : null}
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground"
                  onClick={column?.getToggleSortingHandler()}
                  aria-label={`Sort by ${col.key}`}
                >
                  <span className="truncate">{col.key}</span>
                  {sorted === "asc" ? (
                    <HugeiconsIcon icon={ArrowUp01Icon} className="size-3 shrink-0" aria-hidden />
                  ) : sorted === "desc" ? (
                    <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 shrink-0" aria-hidden />
                  ) : null}
                </button>
                <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/60">
                  {typeGlyph(col.type)}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {findText.trim()
                ? "No matches on this page — increase Limit to search more rows."
                : "No rows."}
            </p>
          ) : (
            virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const original = row.original;
              const isSelected = selected.has(original.id);
              return (
                <div
                  key={row.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  role="row"
                  aria-selected={isSelected}
                  className={cn(
                    "absolute top-0 left-0 border-b border-border/40 last:border-0",
                    isSelected && "bg-muted/40",
                    onOpenRow && "cursor-pointer hover:bg-muted/20",
                  )}
                  style={{ ...gridStyle, transform: `translateY(${virtualRow.start}px)` }}
                >
                  {hasSelect ? (
                    <div
                      className="flex items-center justify-center px-1"
                      style={{ height: rowHeightPx }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select row ${original.id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(original.id)}
                        className="size-3.5 accent-primary"
                      />
                    </div>
                  ) : null}
                  {visibleColumns.map((col, colIndex) => {
                    const value = original.cells[col.key];
                    const isFocused = focused?.row === virtualRow.index && focused.col === colIndex;
                    const isSel = isCellSelected(virtualRow.index, colIndex);
                    const isCut = cutKeys.has(coordKey(virtualRow.index, colIndex));
                    const isEditing = editing?.rowId === original.id && editing.key === col.key;
                    return (
                      <div
                        key={col.key}
                        role="gridcell"
                        aria-selected={isSel || undefined}
                        className={cn(
                          "flex items-center overflow-hidden",
                          isEditing ? "px-0.5" : "px-2.5",
                          isSel && !isEditing && "bg-accent/40",
                          isCut &&
                            "opacity-60 outline-dashed outline-1 -outline-offset-1 outline-ring/60",
                          isFocused && !isEditing && "bg-accent/30 outline-1 outline-ring/50",
                        )}
                        style={{ height: rowHeightPx }}
                        onClick={(e) => {
                          const coord = { row: virtualRow.index, col: colIndex };
                          if (e.shiftKey && focused) {
                            setSelHead(coord);
                            setSelExtra(new Set());
                          } else if (e.ctrlKey || e.metaKey) {
                            setSelExtra((prev) => {
                              const next = new Set(prev);
                              const key = coordKey(coord.row, coord.col);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                            setFocused(coord);
                            setSelHead(null);
                          } else {
                            setFocused(coord);
                            setSelHead(null);
                            setSelExtra(new Set());
                          }
                        }}
                        onDoubleClick={() => {
                          if (isCellEditable(col, value)) {
                            startEdit(original, col, { row: virtualRow.index, col: colIndex });
                          } else {
                            onOpenRow?.(original);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const coord = { row: virtualRow.index, col: colIndex };
                          if (!isCellSelected(coord.row, coord.col)) {
                            setFocused(coord);
                            setSelHead(null);
                            setSelExtra(new Set());
                          }
                          setMenu({ x: e.clientX, y: e.clientY, coord });
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draft}
                            disabled={saving}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit({
                                  row: Math.min(maxRow, editing.row + 1),
                                  col: editing.col,
                                });
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit(
                                  stepCoord(
                                    { row: editing.row, col: editing.col },
                                    e.shiftKey ? -1 : 1,
                                    maxRow,
                                    maxCol,
                                  ),
                                );
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                            aria-label={`Edit ${col.key}`}
                            data-slot="cell-editor"
                            className="h-[26px] w-full min-w-0 rounded-sm bg-background px-1.5 font-mono text-[11px] outline-none ring-1 ring-ring/50"
                          />
                        ) : col.pii && masked && isStorePiiMask(value) ? (
                          <RevealCell
                            refName={storeRef}
                            child={childName}
                            {...(tenant ? { tenant } : {})}
                            rowId={original.id}
                            column={col.key}
                            maskedValue={value}
                          />
                        ) : (
                          <span
                            className="truncate font-mono text-[11px]"
                            dir={isRtlText(value) ? "rtl" : "ltr"}
                            title={formatGridCell(value)}
                          >
                            {formatGridCell(value)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground"
        data-slot="grid-status"
      >
        <span>
          {filteredRows.length} of {model.rows.length} row(s)
          {routedRole ? ` · routed ${routedRole}` : ""}
          {facet === "sql" && masked ? " · PII masked" : ""}
        </span>
        {selectedCellCount > 0 ? (
          <span role="status" data-slot="cell-selection-count">
            {selectedCellCount} cell(s) selected
          </span>
        ) : null}
        {saving ? (
          <span role="status" data-slot="cell-edit-saving">
            Saving…
          </span>
        ) : null}
        {notice ? (
          <span role="status" data-slot="grid-notice">
            {notice}
          </span>
        ) : null}
        {editError ? (
          <span className="text-destructive" role="alert" data-slot="cell-edit-error">
            {editError}
          </span>
        ) : null}
        {findText.trim() ? (
          <span className="ml-auto" role="status" data-slot="find-scope">
            Searching this page’s {model.rows.length} row(s) — increase Limit (current {limit}) to
            search more.
          </span>
        ) : null}
      </div>

      {menu ? (
        <StoreGridContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <StoreGridShortcuts open={showShortcuts} onOpenChange={setShowShortcuts} />
    </div>
  );
}
