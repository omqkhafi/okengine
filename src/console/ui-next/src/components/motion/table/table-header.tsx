/**
 * Sticky header row for the motion Table — sort, resize, reorder, column menu.
 */

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  GripVerticalIcon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Checkbox } from "@/components/motion/checkbox.tsx";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease.ts";
import { motion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";
import { TableMenu, type TableMenuItem } from "./table-menu.tsx";
import type { HeaderCellRefs, InsertPosition, SortState, TableColumn } from "./types.ts";
import { alignFlex, alignText, COLUMN_ACTIVE_SHADOW } from "./utils.ts";

/** Props for {@link TableHeader}. */
export interface TableHeaderProps<T> {
  readonly columns: readonly TableColumn<T>[];
  readonly rowHeight: number;
  readonly reduce: boolean;
  readonly thRefs: HeaderCellRefs;
  readonly selectable: boolean;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly onToggleAll: () => void;
  readonly sort: SortState | null;
  readonly onToggleSort: (key: string) => void;
  readonly resizable: boolean;
  readonly onResizeStart: (key: string, e: ReactPointerEvent) => void;
  readonly onResizeMove: (e: ReactPointerEvent) => void;
  readonly onResizeEnd: (e: ReactPointerEvent) => void;
  readonly reorderable: boolean;
  readonly dragKey: string | null;
  readonly dropIndex: number | null;
  readonly onReorderStart: (key: string, e: ReactPointerEvent) => void;
  readonly onReorderMove: (e: ReactPointerEvent) => void;
  readonly onReorderEnd: (e: ReactPointerEvent) => void;
  readonly onInsertColumn?: (index: number, position: InsertPosition) => void;
  readonly onDeleteColumn?: (columnKey: string, index: number) => void;
  readonly onColumnRename?: (columnKey: string, value: string) => void;
  readonly activeColumn: string | null;
  readonly onColumnActivate?: (key: string) => void;
  readonly onColumnDeactivate?: () => void;
  /** Trailing slack header when no column is marked `fill`. */
  readonly slack?: boolean;
}

/**
 * Insert / delete items shared by the header cell and the portal handle.
 *
 * @param column - Active column
 * @param index - Column index in the current order
 */
function columnMenuItems<T>(
  column: TableColumn<T>,
  index: number,
  onInsertColumn?: (index: number, position: InsertPosition) => void,
  onDeleteColumn?: (columnKey: string, index: number) => void,
): TableMenuItem[] {
  return [
    ...(onInsertColumn
      ? [
          {
            label: "Insert before",
            icon: <HugeiconsIcon icon={ArrowLeft01Icon} />,
            onSelect: () => onInsertColumn(index, "before"),
          },
          {
            label: "Insert after",
            icon: <HugeiconsIcon icon={ArrowRight01Icon} />,
            onSelect: () => onInsertColumn(index, "after"),
          },
        ]
      : []),
    ...(onDeleteColumn
      ? [
          {
            label: "Delete column",
            icon: <HugeiconsIcon icon={Delete02Icon} />,
            destructive: true,
            onSelect: () => onDeleteColumn(column.key, index),
          },
        ]
      : []),
  ];
}

/** Props for {@link ColumnHandle}. */
interface ColumnHandleProps<T> {
  readonly column: TableColumn<T>;
  readonly index: number;
  readonly thRefs: HeaderCellRefs;
  readonly onInsertColumn?: (index: number, position: InsertPosition) => void;
  readonly onDeleteColumn?: (columnKey: string, index: number) => void;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
}

/**
 * Ellipse handle, portaled onto the column's top border so the scroll
 * container cannot clip it. Straddles the border to bridge hover.
 *
 * @param props - Target header cell + insert/delete callbacks
 */
function ColumnHandle<T>({
  column,
  index,
  thRefs,
  onInsertColumn,
  onDeleteColumn,
  onEnter,
  onLeave,
}: ColumnHandleProps<T>): JSX.Element | null {
  useEffect(() => {
    window.addEventListener("scroll", onLeave, true);
    return () => window.removeEventListener("scroll", onLeave, true);
  }, [onLeave]);

  const el = thRefs.current[column.key];
  if (!el || typeof document === "undefined") return null;
  const rect = el.getBoundingClientRect();

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, -50%)",
        zIndex: 40,
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <TableMenu
        ariaLabel={`${column.key} column options`}
        triggerClassName="flex h-2 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        trigger={<HugeiconsIcon icon={MoreHorizontalCircle01Icon} className="size-3" />}
        items={columnMenuItems(column, index, onInsertColumn, onDeleteColumn)}
      />
    </div>,
    document.body,
  );
}

/**
 * Sticky `<thead>` with optional select-all, sort, grip, and resize handles.
 *
 * @param props - Ordered columns + interaction callbacks
 */
export function TableHeader<T>({
  columns,
  rowHeight,
  reduce,
  thRefs,
  selectable,
  allSelected,
  someSelected,
  onToggleAll,
  sort,
  onToggleSort,
  resizable,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  reorderable,
  dragKey,
  dropIndex,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
  onInsertColumn,
  onDeleteColumn,
  onColumnRename,
  activeColumn,
  onColumnActivate,
  onColumnDeactivate,
  slack = true,
}: TableHeaderProps<T>): JSX.Element {
  const hasColumnMenu = !!(onInsertColumn || onDeleteColumn);
  const activeIndex = columns.findIndex((c) => c.key === activeColumn);
  const activeCol = activeIndex >= 0 ? columns[activeIndex] : undefined;

  return (
    <>
      {hasColumnMenu && activeColumn && activeCol ? (
        <ColumnHandle
          column={activeCol}
          index={activeIndex}
          thRefs={thRefs}
          onInsertColumn={onInsertColumn}
          onDeleteColumn={onDeleteColumn}
          onEnter={() => onColumnActivate?.(activeColumn)}
          onLeave={() => onColumnDeactivate?.()}
        />
      ) : null}
      <thead>
        <tr>
          {selectable ? (
            <th className="sticky top-0 z-10 border-b border-border bg-muted p-0 font-medium">
              <div className="flex items-center justify-center" style={{ height: rowHeight }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={() => onToggleAll()}
                  aria-label="Select all rows"
                />
              </div>
            </th>
          ) : null}
          {columns.map((column, index) => {
            const active = sort?.key === column.key;
            const isDragging = dragKey === column.key;
            const isActive = activeColumn === column.key;
            return (
              <th
                key={column.key}
                ref={(el) => {
                  thRefs.current[column.key] = el;
                }}
                onPointerEnter={() => onColumnActivate?.(column.key)}
                onPointerLeave={() => onColumnDeactivate?.()}
                style={isActive ? { boxShadow: COLUMN_ACTIVE_SHADOW } : undefined}
                aria-sort={
                  active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined
                }
                data-drop={dragKey ? dropIndex === index : undefined}
                data-dropend={
                  dragKey ? dropIndex === columns.length && index === columns.length - 1 : undefined
                }
                className={cn(
                  "group relative sticky top-0 z-10 border-b border-border bg-muted p-0 font-medium text-muted-foreground",
                  "data-[drop=true]:before:absolute data-[drop=true]:before:inset-y-0 data-[drop=true]:before:left-0 data-[drop=true]:before:w-0.5 data-[drop=true]:before:bg-primary",
                  "data-[dropend=true]:after:absolute data-[dropend=true]:after:inset-y-0 data-[dropend=true]:after:right-0 data-[dropend=true]:after:w-0.5 data-[dropend=true]:after:bg-primary",
                )}
              >
                <motion.div
                  className={cn("flex h-full w-full min-w-0 items-center", alignFlex(column.align))}
                  style={{ height: rowHeight }}
                  animate={
                    reduce
                      ? { opacity: isDragging ? 0.5 : 1 }
                      : {
                          scale: isDragging ? 1.04 : 1,
                          opacity: isDragging ? 0.5 : 1,
                        }
                  }
                  transition={SPRING_PRESS}
                >
                  {reorderable ? (
                    <button
                      type="button"
                      aria-label={`Reorder ${column.key}`}
                      onPointerDown={(e) => onReorderStart(column.key, e)}
                      onPointerMove={onReorderMove}
                      onPointerUp={onReorderEnd}
                      className="flex h-full w-6 cursor-grab touch-none items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
                    >
                      <HugeiconsIcon icon={GripVerticalIcon} className="size-3.5" />
                    </button>
                  ) : null}
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => onToggleSort(column.key)}
                      className={cn(
                        "flex h-full min-w-0 flex-1 select-none items-center gap-1 px-4 transition-colors hover:text-foreground",
                        alignFlex(column.align),
                        active && "text-foreground",
                      )}
                    >
                      {column.header}
                      <motion.span
                        aria-hidden
                        className="inline-flex shrink-0"
                        animate={{
                          rotate: active && sort?.direction === "desc" ? 180 : 0,
                          opacity: active ? 1 : 0.35,
                        }}
                        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
                      >
                        <HugeiconsIcon icon={ArrowUp01Icon} className="size-3" />
                      </motion.span>
                    </button>
                  ) : onColumnRename ? (
                    <input
                      defaultValue={typeof column.header === "string" ? column.header : column.key}
                      aria-label={`Rename ${column.key}`}
                      onBlur={(e) => onColumnRename(column.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className={cn(
                        "min-w-0 flex-1 truncate appearance-none rounded-md border-0 bg-transparent px-4 font-medium text-muted-foreground outline-none transition-colors focus:bg-muted focus:text-foreground",
                        alignText(column.align),
                      )}
                    />
                  ) : (
                    <div className={cn("min-w-0 flex-1 truncate px-4", alignText(column.align))}>
                      {column.header}
                    </div>
                  )}
                </motion.div>
                {resizable ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.key}`}
                    onPointerDown={(e) => onResizeStart(column.key, e)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeEnd}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/40"
                  />
                ) : null}
              </th>
            );
          })}
          {slack ? (
            <th className="sticky top-0 z-10 border-b border-border bg-muted p-0" aria-hidden />
          ) : null}
        </tr>
      </thead>
    </>
  );
}
