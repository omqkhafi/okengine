/**
 * beUI motion Table — public types (https://beui.dev/components/motion/table).
 */

import type { ReactNode } from "react";
import type { CellRange } from "@/features/store/lib/cell-selection.ts";

/** Sort direction for a column. */
export type SortDirection = "asc" | "desc";

/** Active sort state. */
export type SortState = {
  readonly key: string;
  readonly direction: SortDirection;
};

/**
 * Column descriptor. `key` is the default object property for cell + sort.
 */
export type TableColumn<T> = {
  readonly key: string;
  /** Header content. */
  readonly header: ReactNode;
  /** Allow clicking the header to sort by this column. */
  readonly sortable?: boolean;
  /** Cell text alignment. */
  readonly align?: "left" | "center" | "right";
  /** Column width as a CSS length, e.g. `"160px"` or `"20%"`. */
  readonly width?: string;
  /** Absorb leftover table width instead of leaving a slack column. */
  readonly fill?: boolean;
  /** Custom cell renderer. Falls back to `row[key]`. */
  readonly cell?: (row: T) => ReactNode;
  /** Render an inline text input (ignored when `cell` is set). */
  readonly editable?: boolean;
  /** Value used for sorting. Falls back to `row[key]`. */
  readonly sortValue?: (row: T) => string | number;
};

/** Insert before/after the hovered row or column. */
export type InsertPosition = "before" | "after";

/**
 * Virtualized data table with optional selection, resize, reorder, and inline edit.
 */
export interface TableProps<T> {
  readonly data: readonly T[];
  readonly columns: readonly TableColumn<T>[];
  /** Stable id per row. Defaults to row index. */
  readonly getRowId?: (row: T, index: number) => string;
  /** Render a leading checkbox column with select-all in the header. */
  readonly selectable?: boolean;
  readonly selectedRowIds?: readonly string[];
  readonly defaultSelectedRowIds?: readonly string[];
  readonly onSelectionChange?: (ids: readonly string[]) => void;
  readonly sort?: SortState | null;
  readonly defaultSort?: SortState | null;
  readonly onSortChange?: (sort: SortState | null) => void;
  /** Allow dragging the right edge of a header to resize that column. */
  readonly resizable?: boolean;
  /** Minimum column width in px when resizing. */
  readonly minColumnWidth?: number;
  readonly onColumnResize?: (key: string, width: number) => void;
  /** Allow dragging a header grip to reorder columns. */
  readonly reorderable?: boolean;
  readonly onColumnOrderChange?: (keys: readonly string[]) => void;
  /** Called when an `editable` cell commits (blur / Enter). */
  readonly onCellEdit?: (rowId: string, columnKey: string, value: string) => void;
  /** When set, non-sortable headers become editable inputs for the column name. */
  readonly onColumnRename?: (columnKey: string, value: string) => void;
  /** Enables the row menu (Insert before / after). */
  readonly onInsertRow?: (index: number, position: InsertPosition) => void;
  /** Enables Delete in the row menu. */
  readonly onDeleteRow?: (rowId: string, index: number) => void;
  /** Enables the column menu (Insert before / after). */
  readonly onInsertColumn?: (index: number, position: InsertPosition) => void;
  /** Enables Delete in the column menu. */
  readonly onDeleteColumn?: (columnKey: string, index: number) => void;
  /** Double-click a body row. */
  readonly onRowDoubleClick?: (row: T, id: string) => void;
  /** Two-finger / right-click a body row (caller should `preventDefault`). */
  readonly onRowContextMenu?: (row: T, id: string) => void;
  /** Two-finger / right-click empty viewport (not a row). */
  readonly onViewportContextMenu?: () => void;
  /** Controlled cell range (visible row index × column index). */
  readonly cellRange?: CellRange | null;
  /** Enables drag / Shift+click cell-range selection. */
  readonly onCellRangeChange?: (range: CellRange | null) => void;
  /** Click an already-selected cell (no drag) — start inline edit. */
  readonly onCellActivate?: (row: number, col: number) => void;
  /** Fixed row height in px — required for virtualization. */
  readonly rowHeight?: number;
  /** Scroll viewport height in px. */
  readonly height?: number;
  /** Rows rendered above/below the viewport. */
  readonly overscan?: number;
  /** Fires when the viewport scrolls near the bottom — load the next page. */
  readonly onEndReached?: () => void;
  /** Currently fetching — shows skeleton rows and pauses `onEndReached`. */
  readonly loading?: boolean;
  /** How many skeleton rows to show while loading more. */
  readonly skeletonRows?: number;
  readonly emptyState?: ReactNode;
  readonly className?: string;
}

/** A data row paired with its stable id. */
export type TableRow<T> = { readonly row: T; readonly id: string };

/** Ref map from column key to its header cell, shared across resize/reorder hooks. */
export type HeaderCellRefs = {
  current: Record<string, HTMLTableCellElement | null>;
};
