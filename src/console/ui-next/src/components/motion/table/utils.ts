/**
 * Layout helpers for the motion Table.
 */

import type { ReactNode } from "react";
import { rangeContains, type CellRange } from "@/features/store/lib/cell-selection.ts";
import { cn } from "@/lib/utils.ts";
import type { TableColumn } from "./types.ts";

export const CHECKBOX_PX = 48;
export const CHECKBOX_WIDTH = `${CHECKBOX_PX}px`;

/** Highlights the top edge of the active column's header cell. */
export const COLUMN_ACTIVE_SHADOW = "inset 0 1px 0 var(--color-sky-500)";

/**
 * Selected-row fill — same /10 step as StatusChip sky.
 * Hover steps to /15 so the wash still reads on pointer.
 */
export const ROW_SELECTED_FILL = "bg-sky-500/10";

/** Cell-range fill — one step above row selection. */
export const CELL_RANGE_FILL = "bg-sky-500/15";

/**
 * Bottom hairline painted inside the cell so `overflow-hidden` and
 * `border-collapse` cannot hide it. Selected rows use StatusChip's
 * /25 border step so consecutive selected rows stay distinct.
 *
 * @param selected - Whether the parent row is selected
 */
export function cellHairline(selected: boolean): string {
  return cn(
    "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[1] after:h-px",
    selected ? "after:bg-sky-500/25" : "after:bg-border",
  );
}

/**
 * Flex justification for a column alignment.
 *
 * @param align - Column align
 */
export function alignFlex(align: TableColumn<unknown>["align"]): string {
  if (align === "right") return "justify-end";
  if (align === "center") return "justify-center";
  return "justify-start";
}

/**
 * Text alignment class for a column.
 *
 * @param align - Column align
 */
export function alignText(align: TableColumn<unknown>["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

/**
 * Read a cell's display value.
 *
 * @param row - Data row
 * @param column - Column def
 */
export function readCell<T>(row: T, column: TableColumn<T>): ReactNode {
  if (column.cell) return column.cell(row);
  return (row as Record<string, ReactNode>)[column.key];
}

/**
 * Read a cell's sort value.
 *
 * @param row - Data row
 * @param column - Column def
 */
export function readSortValue<T>(row: T, column: TableColumn<T>): string | number {
  if (column.sortValue) return column.sortValue(row);
  const raw = (row as Record<string, unknown>)[column.key];
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

/**
 * Stringify a row field for the inline editor.
 *
 * @param row - Data row
 * @param key - Column key
 */
export function editableCellValue<T>(row: T, key: string): string {
  const raw = (row as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

/**
 * Whether a visible cell sits inside the range, and whether it is the head
 * (the click origin — draws the 2px primary outline).
 *
 * @param range - Current selection
 * @param row - Visible row index
 * @param col - Visible column index
 */
export function cellRangeFlags(
  range: CellRange | null,
  row: number,
  col: number,
): { readonly inRange: boolean; readonly isHead: boolean } {
  if (!range) return { inRange: false, isHead: false };
  return {
    inRange: rangeContains(range, row, col),
    isHead: range.head.row === row && range.head.col === col,
  };
}
