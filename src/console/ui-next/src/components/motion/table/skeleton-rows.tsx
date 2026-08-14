/**
 * Placeholder rows while the table is loading.
 */

import { type JSX } from "react";
import { cn } from "@/lib/utils.ts";
import type { TableColumn } from "./types.ts";
import { alignText } from "./utils.ts";

/** Props for {@link SkeletonRows}. */
export interface SkeletonRowsProps<T> {
  readonly count: number;
  readonly columns: readonly TableColumn<T>[];
  readonly selectable: boolean;
  readonly rowHeight: number;
  /** Trailing slack cell when no column is marked `fill`. */
  readonly slack?: boolean;
}

/**
 * Pulse placeholders matching the current column layout.
 *
 * @param props - Count + columns
 */
export function SkeletonRows<T>({
  count,
  columns,
  selectable,
  rowHeight,
  slack = true,
}: SkeletonRowsProps<T>): JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, r) => (
        <tr key={r} style={{ height: rowHeight }}>
          {selectable ? <td className="px-4" /> : null}
          {columns.map((column) => (
            <td key={column.key} className={cn("px-4", alignText(column.align))}>
              <div
                className={cn(
                  "h-3 animate-pulse rounded-full bg-muted",
                  column.align === "right" ? "ml-auto w-10" : "w-2/3",
                )}
              />
            </td>
          ))}
          {slack ? <td aria-hidden /> : null}
        </tr>
      ))}
    </>
  );
}
