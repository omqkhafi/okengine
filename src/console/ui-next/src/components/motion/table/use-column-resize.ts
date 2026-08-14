/**
 * Column resize via header trailing-edge drag.
 */

import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";
import type { HeaderCellRefs, TableColumn } from "./types.ts";

/**
 * Snapshot pixel widths and drag one column's trailing edge.
 *
 * @param options - Ordered columns + header refs + min width
 */
export function useColumnResize<T>({
  orderedColumns,
  thRefs,
  minColumnWidth,
  onColumnResize,
}: {
  readonly orderedColumns: readonly TableColumn<T>[];
  readonly thRefs: HeaderCellRefs;
  readonly minColumnWidth: number;
  readonly onColumnResize?: (key: string, width: number) => void;
}): {
  readonly widths: Readonly<Record<string, number>>;
  readonly startResize: (key: string, e: ReactPointerEvent) => void;
  readonly moveResize: (e: ReactPointerEvent) => void;
  readonly endResize: (e: ReactPointerEvent) => void;
} {
  const resizeRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});

  const startResize = useCallback(
    (key: string, e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const snapshot = { ...widths };
      for (const column of orderedColumns) {
        if (snapshot[column.key] == null) {
          const measured = thRefs.current[column.key]?.getBoundingClientRect().width;
          snapshot[column.key] = measured ? Math.round(measured) : minColumnWidth;
        }
      }
      resizeRef.current = {
        key,
        startX: e.clientX,
        startWidth: snapshot[key] ?? minColumnWidth,
      };
      setWidths(snapshot);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [minColumnWidth, orderedColumns, thRefs, widths],
  );

  const moveResize = useCallback(
    (e: ReactPointerEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const width = Math.max(minColumnWidth, state.startWidth + (e.clientX - state.startX));
      setWidths((prev) => ({ ...prev, [state.key]: width }));
    },
    [minColumnWidth],
  );

  const endResize = useCallback(
    (e: ReactPointerEvent) => {
      const state = resizeRef.current;
      resizeRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (state) {
        onColumnResize?.(state.key, widths[state.key] ?? state.startWidth);
      }
    },
    [onColumnResize, widths],
  );

  return { widths, startResize, moveResize, endResize };
}
