/**
 * Helpers for rendering run.input in the trace Request section.
 */

/** Scalar / container kind for a payload field. */
export type InputFieldKind = "string" | "number" | "boolean" | "null" | "object" | "array";

/** One field row in the Fields view, including nested object fields and array items. */
export type InputFieldRow = {
  /** Object key, or array index. */
  readonly key: string;
  /** Raw value (for copy). */
  readonly value: unknown;
  /** Display string in the value column. */
  readonly display: string;
  /** Value kind chip. */
  readonly kind: InputFieldKind;
  /**
   * Nested object fields or array items.
   * `null` for scalars and empty containers — those rows do not expand.
   */
  readonly children: readonly InputFieldRow[] | null;
};

/**
 * Project an object or array into field rows. Nested objects and arrays
 * become expandable child rows. Returns `null` for scalars, `null`, and
 * empty arrays.
 *
 * @param value - Stored run input or output
 */
export function inputFieldRows(value: unknown): readonly InputFieldRow[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item, index) => projectField(String(index), item));
  }
  if (value === null || typeof value !== "object") return null;
  return Object.entries(value as Record<string, unknown>).map(([key, v]) => projectField(key, v));
}

/**
 * Whether a stored payload is worth a Body panel.
 *
 * `null`, `undefined`, `""`, `{}`, and `[]` are empty. A scalar such as
 * `0` or `false` still counts.
 *
 * @param value - Stored run input or output
 */
export function payloadHasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * Human shape hint for the body chrome (e.g. `"2 fields"`).
 *
 * @param value - Stored run input
 */
export function inputShapeHint(value: unknown): string | null {
  if (Array.isArray(value)) {
    const n = value.length;
    return `${n} ${n === 1 ? "item" : "items"}`;
  }
  if (value !== null && typeof value === "object") {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  if (typeof value === "string") return `${value.length} chars`;
  return null;
}

/**
 * Compact UTF-8 byte size label for the serialized body.
 *
 * @param json - Serialized JSON text
 */
export function inputByteLabel(json: string): string {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Clipboard text for a field value — strings as-is, others as JSON.
 *
 * @param value - Field value
 */
export function fieldCopyText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fieldKind(value: unknown): InputFieldKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "string";
  }
}

const PREVIEW_FIELDS = 3;
const PREVIEW_SCALAR_MAX = 42;

function projectField(key: string, value: unknown): InputFieldRow {
  return {
    key,
    value,
    display: formatFieldDisplay(value),
    kind: fieldKind(value),
    children: childRows(value),
  };
}

function childRows(value: unknown): readonly InputFieldRow[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item, index) => projectField(String(index), item));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([key, v]) => projectField(key, v));
  }
  return null;
}

function formatFieldDisplay(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (typeof value === "object") return objectPreview(value as Record<string, unknown>);
  if (typeof value === "bigint") return value.toString();
  return typeof value;
}

/**
 * Short collapsed preview: up to three short scalar fields, otherwise a count.
 *
 * @param value - Plain object
 */
function objectPreview(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const bits: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (bits.length >= PREVIEW_FIELDS) break;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const text = typeof v === "string" ? v : String(v);
    if (text.length === 0 || text.length > PREVIEW_SCALAR_MAX) continue;
    bits.push(`${key}: ${text}`);
  }
  if (bits.length > 0) return bits.join(" · ");
  return `${keys.length} ${keys.length === 1 ? "field" : "fields"}`;
}
