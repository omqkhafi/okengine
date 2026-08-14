/**
 * SQL / path helpers for the Store Pending Changes sheet.
 */

import type { FileDiffLine } from "@/components/agents/file-diff.tsx";
import type { CellUpdate } from "./edit-history.ts";
import { formatGridCell } from "./grid-model.ts";

/**
 * SQL literal for a staged cell value.
 *
 * @param value - Cell value
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "string" ? value : (safeJson(value) ?? "[unserializable]");
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * Breadcrumb path shown on a Visual hunk (`bookings > row bk_8f2a > email`).
 *
 * @param options - Table + row + column
 */
export function pendingChangePath(options: {
  readonly table: string;
  readonly rowId: string;
  readonly key: string;
}): string {
  return `${options.table} > row ${options.rowId} > ${options.key}`;
}

/**
 * Unified-diff lines for one staged cell.
 *
 * @param prev - Value before the edit
 * @param next - Staged value
 */
export function pendingDiffLines(prev: unknown, next: unknown): FileDiffLine[] {
  return [
    { id: "removed", type: "removed", oldLine: 1, content: formatGridCell(prev) },
    { id: "added", type: "added", newLine: 1, content: formatGridCell(next) },
  ];
}

/**
 * Commented UPDATE statements for a pending batch (SQL tab).
 *
 * @param options - Table name + PK + cell updates
 */
export function pendingToSql(options: {
  readonly table: string;
  readonly pk?: string;
  readonly updates: readonly CellUpdate[];
}): string {
  const pk = options.pk ?? "id";
  const byRow = new Map<string, CellUpdate[]>();
  for (const update of options.updates) {
    const list = byRow.get(update.rowId) ?? [];
    list.push(update);
    byRow.set(update.rowId, list);
  }
  const chunks: string[] = [];
  for (const [rowId, sets] of byRow) {
    const first = sets[0];
    const comment =
      sets.length === 1 && first
        ? `-- Update ${first.key} in row ${rowId} of ${options.table}`
        : `-- Update row ${rowId} of ${options.table}`;
    const assignments = sets.map((s) => `"${s.key}" = ${sqlLiteral(s.next)}`).join(", ");
    chunks.push(
      `${comment}\nUPDATE "${options.table}" SET ${assignments} WHERE "${pk}" = ${sqlLiteral(rowId)};`,
    );
  }
  return chunks.join("\n\n");
}

/**
 * `set(key, value, ttl?)` script for a pending KV batch.
 * TTL-only edits keep the identifier `value` — the server reuses the current payload.
 *
 * @param options - Cell updates keyed by KV key (`rowId`)
 */
export function pendingToKv(options: { readonly updates: readonly CellUpdate[] }): string {
  const byKey = new Map<string, CellUpdate[]>();
  for (const update of options.updates) {
    const list = byKey.get(update.rowId) ?? [];
    list.push(update);
    byKey.set(update.rowId, list);
  }
  const chunks: string[] = [];
  for (const [key, sets] of byKey) {
    const valueEdit = sets.find((s) => s.key === "value");
    const ttlEdit = sets.find((s) => s.key === "ttl");
    const valueArg = valueEdit ? jsLiteral(valueEdit.next) : "value";
    const ttlArg =
      ttlEdit === undefined
        ? undefined
        : ttlEdit.next === null || ttlEdit.next === ""
          ? undefined
          : typeof ttlEdit.next === "string"
            ? JSON.stringify(ttlEdit.next)
            : undefined;
    const args = [JSON.stringify(key), valueArg];
    if (ttlArg !== undefined) args.push(ttlArg);
    const comment =
      valueEdit && ttlEdit
        ? `// Update value and TTL on ${key}`
        : ttlEdit && ttlArg === undefined
          ? `// Clear TTL on ${key}`
          : ttlEdit
            ? `// Update TTL on ${key}`
            : `// Update ${key}`;
    chunks.push(`${comment}\nset(${args.join(", ")})`);
  }
  return chunks.join("\n\n");
}

/** JSON / JS literal for a KV `set` argument. */
function jsLiteral(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return "undefined";
  }
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
