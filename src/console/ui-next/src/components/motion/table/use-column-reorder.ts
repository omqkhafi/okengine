/**
 * Column reorder via header grip drag.
 */

import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useState } from "react";
import type { HeaderCellRefs, TableColumn } from "./types.ts";

/**
 * Track column order and pointer-driven reorder.
 *
 * @param options - Columns + header refs + change callback
 */
export function useColumnReorder<T>({
  columns,
  thRefs,
  onColumnOrderChange,
}: {
  readonly columns: readonly TableColumn<T>[];
  readonly thRefs: HeaderCellRefs;
  readonly onColumnOrderChange?: (keys: readonly string[]) => void;
}): {
  readonly orderedColumns: readonly TableColumn<T>[];
  readonly dragKey: string | null;
  readonly dropIndex: number | null;
  readonly startReorder: (key: string, e: ReactPointerEvent) => void;
  readonly moveReorder: (e: ReactPointerEvent) => void;
  readonly endReorder: (e: ReactPointerEvent) => void;
} {
  const [order, setOrder] = useState<string[]>(() => columns.map((c) => c.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const resultKeys = order.filter((k) => byKey.has(k));
    const present = new Set(resultKeys);
    columns.forEach((column, i) => {
      if (present.has(column.key)) return;
      let at = resultKeys.length;
      if (i === 0) {
        at = 0;
      } else {
        const neighbor = columns[i - 1];
        const idx = neighbor ? resultKeys.indexOf(neighbor.key) : -1;
        at = idx === -1 ? i : idx + 1;
      }
      resultKeys.splice(at, 0, column.key);
      present.add(column.key);
    });
    return resultKeys.map((k) => byKey.get(k)).filter((c): c is TableColumn<T> => c !== undefined);
  }, [order, columns]);

  const dropIndexFor = useCallback(
    (clientX: number) => {
      for (let i = 0; i < orderedColumns.length; i++) {
        const col = orderedColumns[i];
        if (!col) continue;
        const rect = thRefs.current[col.key]?.getBoundingClientRect();
        if (rect && clientX < rect.left + rect.width / 2) return i;
      }
      return orderedColumns.length;
    },
    [orderedColumns, thRefs],
  );

  const startReorder = useCallback((key: string, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragKey(key);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const moveReorder = useCallback(
    (e: ReactPointerEvent) => {
      if (!dragKey) return;
      setDropIndex(dropIndexFor(e.clientX));
    },
    [dragKey, dropIndexFor],
  );

  const endReorder = useCallback(
    (e: ReactPointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (dragKey && dropIndex !== null) {
        const keys = orderedColumns.map((c) => c.key);
        const from = keys.indexOf(dragKey);
        if (from !== -1) {
          const without = keys.filter((_, i) => i !== from);
          let to = dropIndex;
          if (from < to) to--;
          without.splice(to, 0, dragKey);
          setOrder(without);
          onColumnOrderChange?.(without);
        }
      }
      setDragKey(null);
      setDropIndex(null);
    },
    [dragKey, dropIndex, orderedColumns, onColumnOrderChange],
  );

  return {
    orderedColumns,
    dragKey,
    dropIndex,
    startReorder,
    moveReorder,
    endReorder,
  };
}
