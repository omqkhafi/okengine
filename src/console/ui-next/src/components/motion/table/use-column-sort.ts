/**
 * Column sort for the motion Table.
 */

import { useCallback, useMemo, useState } from "react";
import type { SortState, TableColumn, TableRow } from "./types.ts";
import { readSortValue } from "./utils.ts";

/**
 * Toggle asc → desc → none and return sorted rows.
 *
 * @param options - Rows + columns + controlled/uncontrolled sort
 */
export function useColumnSort<T>({
  rows,
  columns,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
}: {
  readonly rows: readonly TableRow<T>[];
  readonly columns: readonly TableColumn<T>[];
  readonly sort?: SortState | null;
  readonly defaultSort?: SortState | null;
  readonly onSortChange?: (sort: SortState | null) => void;
}): {
  readonly sort: SortState | null;
  readonly sortedRows: readonly TableRow<T>[];
  readonly toggleSort: (key: string) => void;
} {
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : internalSort;

  const commit = useCallback(
    (next: SortState | null) => {
      if (sortProp === undefined) setInternalSort(next);
      onSortChange?.(next);
    },
    [sortProp, onSortChange],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (!sort || sort.key !== key) {
        commit({ key, direction: "asc" });
      } else if (sort.direction === "asc") {
        commit({ key, direction: "desc" });
      } else {
        commit(null);
      }
    },
    [sort, commit],
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = readSortValue(a.row, column);
      const bv = readSortValue(b.row, column);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, columns]);

  return { sort, sortedRows, toggleSort };
}
