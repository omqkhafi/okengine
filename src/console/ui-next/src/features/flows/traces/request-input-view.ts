/**
 * Helpers for rendering run.input in the trace Request section.
 */

/** Scalar / container kind for a top-level input field. */
export type InputFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array";

/** One top-level field row for the Fields view. */
export type InputFieldRow = {
  /** Object key. */
  readonly key: string;
  /** Raw value (for copy). */
  readonly value: unknown;
  /** Display string in the value column. */
  readonly display: string;
  /** Value kind chip. */
  readonly kind: InputFieldKind;
};

/**
 * Flatten a plain object into field rows. Nested objects/arrays stay as one
 * row with a compact JSON display. Returns `null` when Fields view is not
 * appropriate (arrays, scalars, null).
 *
 * @param value - Stored run input
 */
export function inputFieldRows(value: unknown): readonly InputFieldRow[] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: v,
    display: formatFieldDisplay(v),
    kind: fieldKind(v),
  }));
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

function formatFieldDisplay(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
