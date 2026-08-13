/**
 * Cell selection math + TSV clipboard codec for the Store data grid.
 * Pure functions — no React — so selection behavior stays unit-testable.
 */

/** Zero-based cell coordinate over the *visible* rows/columns. */
export interface CellCoord {
  readonly row: number;
  readonly col: number;
}

/** Inclusive rectangular selection from anchor to head (any direction). */
export interface CellRange {
  readonly anchor: CellCoord;
  readonly head: CellCoord;
}

/** Normalized rectangle bounds for a range. */
export interface RangeBounds {
  readonly minRow: number;
  readonly maxRow: number;
  readonly minCol: number;
  readonly maxCol: number;
}

/** Normalize a (possibly reversed) range into min/max bounds. */
export function rangeBounds(range: CellRange): RangeBounds {
  return {
    minRow: Math.min(range.anchor.row, range.head.row),
    maxRow: Math.max(range.anchor.row, range.head.row),
    minCol: Math.min(range.anchor.col, range.head.col),
    maxCol: Math.max(range.anchor.col, range.head.col),
  };
}

/** True when (row, col) falls inside the inclusive range bounds. */
export function rangeContains(range: CellRange, row: number, col: number): boolean {
  const b = rangeBounds(range);
  return row >= b.minRow && row <= b.maxRow && col >= b.minCol && col <= b.maxCol;
}

/** Number of cells covered by the range. */
export function rangeArea(range: CellRange): number {
  const b = rangeBounds(range);
  return (b.maxRow - b.minRow + 1) * (b.maxCol - b.minCol + 1);
}

/** Every coordinate inside the range, row-major. */
export function rangeCoords(range: CellRange): CellCoord[] {
  const b = rangeBounds(range);
  const out: CellCoord[] = [];
  for (let row = b.minRow; row <= b.maxRow; row++) {
    for (let col = b.minCol; col <= b.maxCol; col++) {
      out.push({ row, col });
    }
  }
  return out;
}

/** Stable string key for a coordinate (Set membership). */
export function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** Inverse of {@link coordKey}; null on malformed input. */
export function parseCoordKey(key: string): CellCoord | null {
  const [row, col] = key.split(":");
  const r = Number(row);
  const c = Number(col);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { row: r, col: c };
}

/** Clamp a coordinate into `0..maxRow` × `0..maxCol`. */
export function clampCoord(coord: CellCoord, maxRow: number, maxCol: number): CellCoord {
  return {
    row: Math.max(0, Math.min(maxRow, coord.row)),
    col: Math.max(0, Math.min(maxCol, coord.col)),
  };
}

/** Linear next/previous cell across rows (Tab order), clamped to bounds. */
export function stepCoord(
  coord: CellCoord,
  dir: 1 | -1,
  maxRow: number,
  maxCol: number,
): CellCoord {
  const width = maxCol + 1;
  const maxIndex = maxRow * width + maxCol;
  const flat = Math.max(0, Math.min(maxIndex, coord.row * width + coord.col + dir));
  return { row: Math.floor(flat / width), col: flat % width };
}

/**
 * Parse clipboard TSV text into a cell matrix. Handles CRLF and the trailing
 * newline spreadsheet apps append. Empty input yields no rows.
 */
export function tsvToMatrix(text: string): string[][] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/**
 * Serialize a matrix to TSV. Tabs/newlines inside cells collapse to spaces so
 * the output stays rectangular.
 */
export function matrixToTsv(matrix: readonly (readonly string[])[]): string {
  return matrix
    .map((line) => line.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}
