/**
 * Console index browse — human text vs pasted vector.
 */

/** Parsed probe / search field. */
export type IndexQuery =
  | { readonly kind: "empty" }
  | { readonly kind: "vector"; readonly vector: readonly number[] }
  | { readonly kind: "text"; readonly q: string };

const VECTOR_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse comma-separated numbers into a vector, or null when empty / invalid.
 *
 * @param text - Raw input
 */
export function parseVector(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s,]+/).filter((part) => part.length > 0);
  const nums: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums.length > 0 ? nums : null;
}

/**
 * True when the field is a pasted vector (two or more numeric tokens, no words).
 *
 * @param text - Raw input
 */
export function isProbeVector(text: string): boolean {
  const parts = text
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  return parts.length >= 2 && parts.every((part) => VECTOR_TOKEN.test(part));
}

/**
 * Classify the index search field: empty, ANN probe, or human text.
 *
 * @param text - Raw input
 */
export function parseIndexQuery(text: string): IndexQuery {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (isProbeVector(trimmed)) {
    const vector = parseVector(trimmed);
    if (vector && vector.length >= 2) return { kind: "vector", vector };
  }
  return { kind: "text", q: trimmed };
}
