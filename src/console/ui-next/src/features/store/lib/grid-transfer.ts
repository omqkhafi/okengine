/**
 * CSV / JSON codec for Store grid import and export.
 * Pure functions — no DOM — so round-trips stay unit-testable.
 */

import type { PasteHit } from "./pending-edits.ts";
import { STORE_PII_MASK } from "./patch.ts";
import { tsvToMatrix } from "./cell-selection.ts";

/** Row id fields used to match an import record onto a loaded grid row. */
const ROW_ID_KEYS = ["id", "key"] as const;

/**
 * Serialize a cell for CSV. Null/undefined become empty; objects JSON-encode.
 * Unlike {@link formatGridCell}, this never emits the display placeholder "—".
 *
 * @param value - Raw overlay value
 */
export function cellExportText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * RFC 4180 field quoting. Quotes wrap a cell that contains a comma, quote, or newline.
 *
 * @param value - Raw cell text
 */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * Serialize a header + body matrix to CSV (no trailing newline on a single empty table).
 *
 * @param headers - Column keys
 * @param rows - Cell text, aligned to headers
 */
export function rowsToCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((_, i) => csvEscape(row[i] ?? "")).join(","));
  }
  return lines.join("\n");
}

/**
 * Parse RFC 4180 CSV into a rectangular matrix. Strips a leading BOM.
 * Throws on an unclosed quote.
 *
 * @param text - File contents
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Turn a headered matrix into records. Empty files or header-only files yield [].
 *
 * @param matrix - First row is column keys
 */
export function recordsFromHeaderMatrix(
  matrix: readonly (readonly string[])[],
): Record<string, string>[] {
  const header = matrix[0];
  if (!header || header.length === 0) return [];
  const records: Record<string, string>[] = [];
  for (const line of matrix.slice(1)) {
    const rec: Record<string, string> = {};
    let any = false;
    for (let i = 0; i < header.length; i++) {
      const key = header[i]?.trim();
      if (!key) continue;
      rec[key] = line[i] ?? "";
      any = true;
    }
    if (any) records.push(rec);
  }
  return records;
}

/**
 * Parse a JSON array of objects into string-valued records.
 *
 * @param text - File contents
 */
export function parseJsonRecords(text: string): Record<string, string>[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON import must be an array of objects");
  return data.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("JSON import must be an array of objects");
    }
    const rec: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      rec[key] = cellExportText(value);
    }
    return rec;
  });
}

/**
 * Detect CSV vs JSON and return headered records.
 *
 * @param text - File contents
 */
export function parseImportRecords(text: string): Record<string, string>[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJsonRecords(trimmed);
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t") && !firstLine.includes(",")) {
    return recordsFromHeaderMatrix(tsvToMatrix(text));
  }
  return recordsFromHeaderMatrix(parseCsv(text));
}

/** Result of mapping import records onto loaded rows. */
export interface ImportHitsResult {
  readonly hits: PasteHit[];
  readonly unmatched: number;
}

/**
 * Map import records onto loaded row ids. Matches `id` then `key`.
 * Skips identity columns, PII mask placeholders, and non-writable cells.
 * Unmatched records are counted, not applied.
 *
 * @param options - Records + loaded ids + writable predicate
 */
export function importHits(options: {
  readonly records: readonly Readonly<Record<string, string>>[];
  readonly rowIds: ReadonlySet<string>;
  readonly writable: (rowId: string, key: string) => boolean;
}): ImportHitsResult {
  let unmatched = 0;
  const hits: PasteHit[] = [];
  for (const rec of options.records) {
    const rowId = matchRowId(rec, options.rowIds);
    if (rowId === null) {
      unmatched += 1;
      continue;
    }
    for (const [key, text] of Object.entries(rec)) {
      if ((ROW_ID_KEYS as readonly string[]).includes(key)) continue;
      if (text === STORE_PII_MASK) continue;
      if (!options.writable(rowId, key)) continue;
      hits.push({ rowId, key, text });
    }
  }
  return { hits, unmatched };
}

function matchRowId(
  rec: Readonly<Record<string, string>>,
  rowIds: ReadonlySet<string>,
): string | null {
  for (const key of ROW_ID_KEYS) {
    const value = rec[key]?.trim();
    if (value && rowIds.has(value)) return value;
  }
  return null;
}
