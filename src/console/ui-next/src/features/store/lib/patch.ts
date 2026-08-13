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
  type: "string" | "integer" | "json" | "number",
  text: string,
): unknown {
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
