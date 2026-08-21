/**
 * Virtualized motion Table (beUI) — selection, sort, resize, reorder, inline edit.
 *
 * @see https://beui.dev/components/motion/table
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Checkbox } from "@/components/motion/checkbox.tsx";
import { useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";
import { EditableCell } from "./editable-cell.tsx";
import { RowHandle } from "./row-handle.tsx";
import { SkeletonRows } from "./skeleton-rows.tsx";
import { TableHeader } from "./table-header.tsx";
import type { HeaderCellRefs, TableProps } from "./types.ts";
import { useColumnReorder } from "./use-column-reorder.ts";
import { useColumnResize } from "./use-column-resize.ts";
import { useColumnSort } from "./use-column-sort.ts";
import { useRowSelection } from "./use-row-selection.ts";
import { useCellRange } from "./use-cell-range.ts";
import {
  CHECKBOX_WIDTH,
  CELL_RANGE_FILL,
  ROW_SELECTED_FILL,
  TABLE_CHECKBOX_CLASS,
  alignText,
  cellHairline,
  cellRangeFlags,
  editableCellValue,
  readCell,
} from "./utils.ts";

export type { SortDirection, SortState, TableColumn, TableProps } from "./types.ts";

/**
 * Virtualized data table. Pass `onCellEdit` / `onDeleteRow` for the editable variant.
 *
 * @param props - Data, columns, and optional interaction callbacks
 */
export function Table<T>({
  data,
  columns,
  getRowId,
  selectable = false,
  selectedRowIds,
  defaultSelectedRowIds,
  onSelectionChange,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  resizable = false,
  minColumnWidth = 64,
  onColumnResize,
  reorderable = false,
  onColumnOrderChange,
  onCellEdit,
  onColumnRename,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  onRowDoubleClick,
  onRowContextMenu,
  onViewportContextMenu,
  cellRange = null,
  onCellRangeChange,
  onCellActivate,
  rowHeight = 48,
  height = 440,
  overscan = 10,
  onEndReached,
  loading = false,
  skeletonRows = 3,
  emptyState = "No data",
  className,
}: TableProps<T>): JSX.Element {
  const reduce = !!useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const thRefs: HeaderCellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  const rows = useMemo(
    () =>
      data.map((row, index) => ({
        row,
        id: getRowId ? getRowId(row, index) : String(index),
      })),
    [data, getRowId],
  );

  const { orderedColumns, dragKey, dropIndex, startReorder, moveReorder, endReorder } =
    useColumnReorder({ columns, thRefs, onColumnOrderChange });

  const { sort, sortedRows, toggleSort } = useColumnSort({
    rows,
    columns,
    sort: sortProp,
    defaultSort,
    onSortChange,
  });

  const { widths, startResize, moveResize, endResize } = useColumnResize({
    orderedColumns,
    thRefs,
    minColumnWidth,
    onColumnResize,
  });

  const { selected, allSelected, someSelected, toggleAll, toggleRow } = useRowSelection({
    sortedRows,
    selectedRowIds,
    defaultSelectedRowIds,
    onSelectionChange,
  });

  const cellSelect = useCellRange({
    enabled: onCellRangeChange !== undefined,
    range: cellRange,
    onChange: onCellRangeChange,
    onActivate: onCellActivate,
  });

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstVirtual = virtualItems[0];
  const lastVirtual = virtualItems[virtualItems.length - 1];
  const paddingTop = firstVirtual ? firstVirtual.start : 0;
  const paddingBottom = lastVirtual ? totalSize - lastVirtual.end : 0;

  const hasRowMenu = !!(onInsertRow || onDeleteRow);
  const sized = orderedColumns.length > 0 && orderedColumns.every((c) => widths[c.key] != null);

  const endReachedRef = useRef(false);
  useEffect(() => {
    if (!loading) endReachedRef.current = false;
  }, [loading]);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !onEndReached || loading || endReachedRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight * 4) {
      endReachedRef.current = true;
      onEndReached();
    }
  }, [onEndReached, loading, rowHeight]);

  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const deactivateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activateColumn = useCallback((key: string) => {
    if (deactivateTimer.current) clearTimeout(deactivateTimer.current);
    deactivateTimer.current = null;
    setActiveColumn(key);
  }, []);
  const deactivateColumn = useCallback(() => {
    if (deactivateTimer.current) clearTimeout(deactivateTimer.current);
    deactivateTimer.current = setTimeout(() => setActiveColumn(null), 100);
  }, []);

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [activeRow, setActiveRow] = useState<{ id: string; index: number } | null>(null);
  const rowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activateRow = useCallback((id: string, index: number) => {
    if (rowTimer.current) clearTimeout(rowTimer.current);
    rowTimer.current = null;
    setActiveRow({ id, index });
  }, []);
  const deactivateRow = useCallback(() => {
    if (rowTimer.current) clearTimeout(rowTimer.current);
    rowTimer.current = setTimeout(() => setActiveRow(null), 100);
  }, []);
  const activeRowEl = activeRow ? (rowRefs.current[activeRow.id] ?? null) : null;
  const leadColumns = columns.length + (selectable ? 1 : 0);
  const slack = !orderedColumns.some((c) => c.fill && widths[c.key] == null);
  const span = leadColumns + (slack ? 1 : 0);

  return (
    <div
      className={cn(
        "w-full overflow-hidden border border-border/60 bg-background text-sm",
        className,
      )}
    >
      <div
        ref={scrollRef}
        data-slot="table-scroller"
        onScroll={handleScroll}
        onPointerDown={cellSelect.onScrollerPointerDown}
        onPointerMove={cellSelect.onScrollerPointerMove}
        onPointerUp={cellSelect.onPointerUp}
        onPointerCancel={cellSelect.onPointerUp}
        onContextMenu={(event) => {
          if (!onViewportContextMenu) return;
          const target = event.target;
          if (target instanceof Element && target.closest("[data-slot='table-row']")) return;
          event.preventDefault();
          onViewportContextMenu();
        }}
        className={cn("overflow-auto", onCellRangeChange ? "select-none" : undefined)}
        style={{ height }}
      >
        <table
          className={cn("border-collapse", sized ? "w-max min-w-full" : "min-w-full")}
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            {selectable ? <col style={{ width: CHECKBOX_WIDTH }} /> : null}
            {orderedColumns.map((column) => {
              const override = widths[column.key];
              const width = override != null ? `${override}px` : column.width;
              return <col key={column.key} style={width ? { width } : undefined} />;
            })}
            {slack ? <col /> : null}
          </colgroup>

          <TableHeader
            columns={orderedColumns}
            rowHeight={rowHeight}
            reduce={reduce}
            thRefs={thRefs}
            selectable={selectable}
            allSelected={allSelected}
            someSelected={someSelected}
            onToggleAll={toggleAll}
            sort={sort}
            onToggleSort={toggleSort}
            resizable={resizable}
            onResizeStart={startResize}
            onResizeMove={moveResize}
            onResizeEnd={endResize}
            reorderable={reorderable}
            dragKey={dragKey}
            dropIndex={dropIndex}
            onReorderStart={startReorder}
            onReorderMove={moveReorder}
            onReorderEnd={endReorder}
            onInsertColumn={onInsertColumn}
            onDeleteColumn={onDeleteColumn}
            onColumnRename={onColumnRename}
            activeColumn={activeColumn}
            onColumnActivate={activateColumn}
            onColumnDeactivate={deactivateColumn}
            slack={slack}
          />

          <tbody>
            {sortedRows.length === 0 ? (
              loading ? (
                <SkeletonRows
                  count={skeletonRows}
                  columns={orderedColumns}
                  selectable={selectable}
                  rowHeight={rowHeight}
                  slack={slack}
                />
              ) : (
                <tr>
                  <td colSpan={span} className="px-4 py-8 text-center text-muted-foreground">
                    {emptyState}
                  </td>
                </tr>
              )
            ) : (
              <>
                {paddingTop > 0 ? (
                  <tr>
                    <td colSpan={span} style={{ height: paddingTop, padding: 0, border: "none" }} />
                  </tr>
                ) : null}
                {virtualItems.map((vItem) => {
                  const entry = sortedRows[vItem.index];
                  if (!entry) return null;
                  const isSelected = selected.has(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      ref={(el) => {
                        rowRefs.current[entry.id] = el;
                      }}
                      data-slot="table-row"
                      data-selected={isSelected}
                      style={{ height: rowHeight }}
                      onPointerEnter={
                        hasRowMenu ? () => activateRow(entry.id, vItem.index) : undefined
                      }
                      onPointerLeave={hasRowMenu ? deactivateRow : undefined}
                      onContextMenu={(event) => {
                        if (!onRowContextMenu) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onRowContextMenu(entry.row, entry.id);
                      }}
                      onDoubleClick={(e) => {
                        if (!onRowDoubleClick) return;
                        const target = e.target;
                        if (
                          target instanceof Element &&
                          target.closest(
                            "input, textarea, button, [role='checkbox'], [data-slot='cell-display']",
                          )
                        ) {
                          return;
                        }
                        onRowDoubleClick(entry.row, entry.id);
                      }}
                      className={cn(
                        "transition-colors hover:bg-muted/50",
                        "data-[selected=true]:bg-sky-500/10 data-[selected=true]:hover:bg-sky-500/15",
                      )}
                    >
                      {selectable ? (
                        <td
                          className={cn(
                            "px-4 align-middle",
                            cellHairline(isSelected),
                            isSelected && ROW_SELECTED_FILL,
                          )}
                        >
                          <div
                            className="flex items-center justify-center"
                            style={{ height: rowHeight }}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRow(entry.id)}
                              aria-label={`Select row ${vItem.index + 1}`}
                              className={TABLE_CHECKBOX_CLASS}
                            />
                          </div>
                        </td>
                      ) : null}
                      {orderedColumns.map((column, colIndex) => {
                        const flags = cellRangeFlags(cellRange, vItem.index, colIndex);
                        return (
                          <td
                            key={column.key}
                            data-slot="table-cell"
                            data-row={String(vItem.index)}
                            data-col={String(colIndex)}
                            data-range={flags.inRange ? "in" : undefined}
                            data-range-head={flags.isHead ? "true" : undefined}
                            className={cn(
                              "relative h-full cursor-cell overflow-hidden p-0",
                              alignText(column.align),
                              cellHairline(isSelected),
                              !flags.inRange && "has-[[data-pending=true]]:bg-amber-500/10",
                              flags.inRange && CELL_RANGE_FILL,
                              flags.isHead &&
                                "z-[1] shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--color-sky-500)_45%,transparent)] has-[input]:shadow-none",
                            )}
                            onPointerDown={(event) =>
                              cellSelect.onCellPointerDown(vItem.index, colIndex, event)
                            }
                          >
                            {!column.cell && column.editable ? (
                              <span className="absolute inset-0 flex items-center px-4">
                                <EditableCell
                                  value={editableCellValue(entry.row, column.key)}
                                  label={
                                    typeof column.header === "string" ? column.header : column.key
                                  }
                                  onChange={(next) => onCellEdit?.(entry.id, column.key, next)}
                                />
                              </span>
                            ) : (
                              readCell(entry.row, column)
                            )}
                          </td>
                        );
                      })}
                      {slack ? (
                        <td
                          aria-hidden
                          className={cn(cellHairline(isSelected), isSelected && ROW_SELECTED_FILL)}
                        />
                      ) : null}
                    </tr>
                  );
                })}
                {paddingBottom > 0 ? (
                  <tr>
                    <td
                      colSpan={span}
                      style={{ height: paddingBottom, padding: 0, border: "none" }}
                    />
                  </tr>
                ) : null}
                {loading ? (
                  <SkeletonRows
                    count={skeletonRows}
                    columns={orderedColumns}
                    selectable={selectable}
                    rowHeight={rowHeight}
                    slack={slack}
                  />
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      {hasRowMenu && activeRow ? (
        <RowHandle
          rowEl={activeRowEl}
          id={activeRow.id}
          index={activeRow.index}
          onInsertRow={onInsertRow}
          onDeleteRow={onDeleteRow}
          onEnter={() => activateRow(activeRow.id, activeRow.index)}
          onLeave={deactivateRow}
        />
      ) : null}
    </div>
  );
}
