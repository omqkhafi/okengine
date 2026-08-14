/**
 * Pointer-driven rectangular cell range for the motion Table.
 *
 * Capture lives on the scroller (not the cell) so drag can cross rows;
 * `elementFromPoint` maps the pointer to `data-row` / `data-col`.
 */

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { CellRange } from "@/features/store/lib/cell-selection.ts";

const INTERACTIVE = "input, textarea, button, [role='checkbox']";
const DRAG_PX = 4;

/** Options for {@link useCellRange}. */
export interface UseCellRangeOptions {
  readonly enabled: boolean;
  readonly range: CellRange | null;
  readonly onChange?: (range: CellRange | null) => void;
  /** Fires on a click that didn't drag, when the cell was already a 1×1 selection. */
  readonly onActivate?: (row: number, col: number) => void;
}

/**
 * Read visible row/col from a table cell (or a descendant).
 *
 * @param target - Event target or hit-test node
 */
export function readTableCellCoord(
  target: EventTarget | null,
): { row: number; col: number } | null {
  if (!(target instanceof Element)) return null;
  const td = target.closest("[data-slot='table-cell']");
  if (!td) return null;
  const row = Number(td.getAttribute("data-row"));
  const col = Number(td.getAttribute("data-col"));
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
  return { row, col };
}

function isSameCell(range: CellRange | null, row: number, col: number): boolean {
  if (!range) return false;
  return (
    range.anchor.row === row &&
    range.anchor.col === col &&
    range.head.row === row &&
    range.head.col === col
  );
}

/**
 * Drag / Shift+click cell selection over visible row × column indices.
 *
 * @param options - Enabled flag + controlled range
 */
export function useCellRange(options: UseCellRangeOptions): {
  readonly onCellPointerDown: (
    row: number,
    col: number,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  readonly onScrollerPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onScrollerPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: () => void;
} {
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const activateOnUpRef = useRef(false);
  const originRef = useRef<{ x: number; y: number; row: number; col: number } | null>(null);
  const rangeRef = useRef(options.range);
  rangeRef.current = options.range;
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const onActivateRef = useRef(options.onActivate);
  onActivateRef.current = options.onActivate;
  const enabledRef = useRef(options.enabled);
  enabledRef.current = options.enabled;

  const onCellPointerDown = useCallback(
    (row: number, col: number, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabledRef.current || event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE)) return;
      draggingRef.current = true;
      movedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY, row, col };
      activateOnUpRef.current = !event.shiftKey && isSameCell(rangeRef.current, row, col);
      const scroller = event.currentTarget.closest("[data-slot='table-scroller']");
      if (scroller instanceof HTMLElement) scroller.setPointerCapture?.(event.pointerId);
      const current = rangeRef.current;
      if (event.shiftKey && current) {
        onChangeRef.current?.({ anchor: current.anchor, head: { row, col } });
      } else {
        onChangeRef.current?.({ anchor: { row, col }, head: { row, col } });
      }
    },
    [],
  );

  const onScrollerPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current || event.button !== 0) return;
    if (readTableCellCoord(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest("thead, button, input, textarea, [role='checkbox']")
    ) {
      return;
    }
    onChangeRef.current?.(null);
  }, []);

  const onScrollerPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const origin = originRef.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_PX) {
      movedRef.current = true;
      activateOnUpRef.current = false;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const coord = readTableCellCoord(hit);
    if (!coord) return;
    const current = rangeRef.current;
    const anchor = current?.anchor ?? origin ?? coord;
    onChangeRef.current?.({
      anchor: { row: anchor.row, col: anchor.col },
      head: coord,
    });
  }, []);

  const onPointerUp = useCallback(() => {
    const origin = originRef.current;
    const activate = activateOnUpRef.current && !movedRef.current;
    draggingRef.current = false;
    movedRef.current = false;
    activateOnUpRef.current = false;
    originRef.current = null;
    if (activate && origin) onActivateRef.current?.(origin.row, origin.col);
  }, []);

  return {
    onCellPointerDown,
    onScrollerPointerDown,
    onScrollerPointerMove,
    onPointerUp,
  };
}
