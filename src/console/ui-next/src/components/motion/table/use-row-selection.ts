/**
 * Row selection for the motion Table.
 */

import { useCallback, useMemo, useState } from "react";
import type { TableRow } from "./types.ts";

/**
 * Checkbox selection over the currently sorted row set.
 *
 * @param options - Sorted rows + controlled/uncontrolled ids
 */
export function useRowSelection<T>({
  sortedRows,
  selectedRowIds,
  defaultSelectedRowIds,
  onSelectionChange,
}: {
  readonly sortedRows: readonly TableRow<T>[];
  readonly selectedRowIds?: readonly string[];
  readonly defaultSelectedRowIds?: readonly string[];
  readonly onSelectionChange?: (ids: readonly string[]) => void;
}): {
  readonly selected: ReadonlySet<string>;
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly toggleAll: () => void;
  readonly toggleRow: (id: string) => void;
} {
  const [internalSelected, setInternalSelected] = useState<Set<string>>(
    () => new Set(defaultSelectedRowIds),
  );
  const selected = useMemo(
    () => (selectedRowIds !== undefined ? new Set(selectedRowIds) : internalSelected),
    [selectedRowIds, internalSelected],
  );

  const commit = useCallback(
    (next: Set<string>) => {
      if (selectedRowIds === undefined) setInternalSelected(next);
      onSelectionChange?.([...next]);
    },
    [selectedRowIds, onSelectionChange],
  );

  const allSelected = sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id));
  const someSelected = sortedRows.some((r) => selected.has(r.id));

  const toggleAll = useCallback(() => {
    const next = new Set(selected);
    if (allSelected) {
      for (const r of sortedRows) next.delete(r.id);
    } else {
      for (const r of sortedRows) next.add(r.id);
    }
    commit(next);
  }, [allSelected, sortedRows, selected, commit]);

  const toggleRow = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      commit(next);
    },
    [selected, commit],
  );

  return { selected, allSelected, someSelected, toggleAll, toggleRow };
}
