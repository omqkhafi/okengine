/**
 * Patch hygiene for Store edits — never persist the PII mask placeholder.
 */

/** Mask token rendered for masked PII cells (matches server `PII_MASK`). */
export const STORE_PII_MASK = "[redacted]";

/**
 * Drop any patch entry whose value is the PII mask placeholder so a save can
 * never silently overwrite real data with "[redacted]".
 *
 * @param patch - Raw edit patch
 */
export function sanitizeStorePatch(
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === STORE_PII_MASK) continue;
    out[key] = value;
  }
  return out;
}

/**
 * True when a value is the PII mask placeholder (cell still masked).
 */
export function isStorePiiMask(value: unknown): boolean {
  return value === STORE_PII_MASK;
}

/**
 * Parse a draft string into a typed cell value: `integer` truncates, `number`
 * keeps floats, `json` parses (falling back to the raw string), anything else
 * stays a string. Shared by the inline grid editor and the edit Sheet.
 *
 * @param type - Grid column type
 * @param text - Raw draft text
 */
export function parseStoreCellDraft(
  type: "string" | "integer" | "json" | "number" | "boolean",
  text: string,
): unknown {
  if (type === "boolean") {
    const t = text.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes" || t === "on") return true;
    if (t === "false" || t === "0" || t === "no" || t === "off" || t === "") return false;
    return text;
  }
  if (type === "integer") {
    const n = Number(text);
    return Number.isFinite(n) ? Math.trunc(n) : text;
  }
  if (type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (type === "json") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** One column used when building an insert patch from form drafts. */
export type InsertDraftColumn = {
  readonly key: string;
  readonly type: "string" | "integer" | "json" | "number" | "boolean";
};

/**
 * Seed the insert form. `id` gets a UUID; other columns stay empty (NULL).
 *
 * @param columns - Grid / Manifest columns
 */
export function defaultInsertDraft(columns: readonly InsertDraftColumn[]): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const col of columns) {
    draft[col.key] = col.key === "id" ? crypto.randomUUID() : "";
  }
  if (!("id" in draft)) draft.id = crypto.randomUUID();
  return draft;
}

/**
 * Columns shown on the insert form. Always includes `id`.
 *
 * @param columns - Grid columns
 */
export function insertFormColumns(columns: readonly InsertDraftColumn[]): InsertDraftColumn[] {
  if (columns.some((col) => col.key === "id")) return [...columns];
  return [{ key: "id", type: "string" }, ...columns];
}

/**
 * Build an INSERT patch from form drafts. Empty fields are omitted (NULL).
 * Requires a non-empty `id`.
 *
 * @param columns - Grid / Manifest columns
 * @param draft - Per-column text
 */
export function buildInsertPatch(
  columns: readonly InsertDraftColumn[],
  draft: Readonly<Record<string, string>>,
):
  | { readonly ok: true; readonly patch: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  const patch: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const col of columns) {
    seen.add(col.key);
    const text = draft[col.key] ?? "";
    if (text.trim() === "") continue;
    patch[col.key] = parseStoreCellDraft(col.type, text);
  }
  if (!seen.has("id")) {
    const text = draft.id ?? "";
    if (text.trim() !== "") patch.id = text.trim();
  }
  const clean = sanitizeStorePatch(patch);
  const id = clean.id;
  if ((typeof id !== "string" || id.length === 0) && typeof id !== "number") {
    return { ok: false, error: "id is required" };
  }
  return { ok: true, patch: clean };
}
