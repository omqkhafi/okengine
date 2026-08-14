/**
 * Inspectable JSON for Store grid cells (KV `value`, Index `meta`, JSON strings).
 */

/** One flattened field in a JSON inspect table. */
export interface JsonFieldRow {
  readonly path: string;
  readonly value: unknown;
  readonly kind: JsonFieldKind;
}

/** Leaf / empty-container kinds shown in the inspect table. */
export type JsonFieldKind = "string" | "number" | "boolean" | "null" | "array" | "object";

/** Result of parsing a JSON editor draft. */
export type InspectableJsonParse =
  | { readonly ok: true; readonly value: object }
  | { readonly ok: false; readonly error: string };

/**
 * Parse a cell into an object or array when it is already structured JSON
 * or a JSON string of an object/array. Primitives and invalid JSON return null.
 *
 * @param value - Raw grid cell
 */
export function asInspectableJson(value: unknown): object | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}

/**
 * Parse a JSON editor draft. Objects and arrays succeed; anything else
 * returns a short reason so the sheet can keep the invalid text.
 *
 * @param text - Editor contents
 */
export function parseInspectableJsonText(text: string): InspectableJsonParse {
  const parsed = asInspectableJson(text);
  if (parsed !== null) return { ok: true, value: parsed };
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "JSON is empty" };
  try {
    JSON.parse(trimmed);
    return { ok: false, error: "JSON must be an object or array" };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

/**
 * Flatten inspectable JSON into dotted / indexed field rows.
 * Empty root objects and arrays yield no rows.
 *
 * @param value - Raw grid cell
 */
export function jsonFieldRows(value: unknown): readonly JsonFieldRow[] {
  const parsed = asInspectableJson(value);
  if (parsed === null) return [];
  return walkJson(parsed, "");
}

/**
 * Draft text for an inspect-table field (empty containers stay `{}` / `[]`).
 *
 * @param value - Field value
 * @param kind - Flattened field kind
 */
export function fieldDraftText(value: unknown, kind: JsonFieldKind): string {
  if (kind === "object") return "{}";
  if (kind === "array") return "[]";
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Parse an inspect-table draft back to a JSON value, preserving `kind` when
 * the text is valid for that kind.
 *
 * @param kind - Current field kind
 * @param text - Draft from the value input
 */
export function parseJsonFieldDraft(kind: JsonFieldKind, text: string): unknown {
  if (kind === "string") return text;
  const trimmed = text.trim();
  if (kind === "number") {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : text;
  }
  if (kind === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "") return null;
    return text;
  }
  if (kind === "null") {
    if (trimmed === "" || trimmed === "null") return null;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const n = Number(trimmed);
    if (Number.isFinite(n) && trimmed !== "") return n;
    return text;
  }
  if (kind === "object" || kind === "array") {
    if (trimmed === "") return kind === "array" ? [] : {};
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Write `next` at a flattened path (`user.name`, `tags[0]`, `[0].id`).
 * Clones `root` so the live grid row is never mutated.
 *
 * @param root - Inspectable object or array
 * @param path - Flattened field path
 * @param next - Replacement value
 */
export function setJsonField(root: unknown, path: string, next: unknown): unknown {
  const segs = parseJsonPath(path);
  if (segs.length === 0) return next;
  const clone: unknown = structuredClone(root);
  let cursor: unknown = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (!seg) return clone;
    cursor = readPathSeg(cursor, seg);
  }
  const last = segs[segs.length - 1];
  if (last) writePathSeg(cursor, last, next);
  return clone;
}

/**
 * True when two JSON values stringify equal (used to drop a no-op stage).
 *
 * @param left - First value
 * @param right - Second value
 */
export function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

type PathSeg =
  | { readonly type: "key"; readonly key: string }
  | { readonly type: "index"; readonly index: number };

function parseJsonPath(path: string): readonly PathSeg[] {
  const segs: PathSeg[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      i += 1;
      continue;
    }
    if (ch === "[") {
      const end = path.indexOf("]", i);
      if (end < 0) break;
      segs.push({ type: "index", index: Number(path.slice(i + 1, end)) });
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j += 1;
    segs.push({ type: "key", key: path.slice(i, j) });
    i = j;
  }
  return segs;
}

function readPathSeg(cursor: unknown, seg: PathSeg): unknown {
  if (cursor === null || typeof cursor !== "object") return undefined;
  if (seg.type === "key") return (cursor as Record<string, unknown>)[seg.key];
  return (cursor as unknown[])[seg.index];
}

function writePathSeg(cursor: unknown, seg: PathSeg, next: unknown): void {
  if (cursor === null || typeof cursor !== "object") return;
  if (seg.type === "key") {
    (cursor as Record<string, unknown>)[seg.key] = next;
    return;
  }
  (cursor as unknown[])[seg.index] = next;
}

/**
 * Pretty-print inspectable JSON; fall back to the raw cell string.
 *
 * @param value - Raw grid cell
 */
export function prettyJsonCell(value: unknown): string {
  const parsed = asInspectableJson(value);
  if (parsed !== null) {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return "[unserializable]";
    }
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function walkJson(value: unknown, prefix: string): JsonFieldRow[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return prefix ? [{ path: prefix, value, kind: "object" }] : [];
    }
    return entries.flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return walkJson(child, path);
    });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [{ path: prefix, value, kind: "array" }] : [];
    }
    return value.flatMap((child, index) => {
      const path = prefix ? `${prefix}[${index}]` : `[${index}]`;
      return walkJson(child, path);
    });
  }
  return [{ path: prefix || "(root)", value, kind: jsonKind(value) }];
}

function jsonKind(value: unknown): JsonFieldKind {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "string";
}
