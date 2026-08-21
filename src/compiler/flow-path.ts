/**
 * File-tree URL + Flow-name stamps.
 *
 * One catalog for the adopt generator and Manifest extract — never derive a
 * URL from `flow("notes.get")`. Always POSIX-normalize first; Windows `\`
 * must not leak into inferred paths or generated import specifiers.
 */

/** Reserved leaves that do not add a URL segment (same five as `http.resource`, plus `index` / `route`). */
export const RESERVED_LEAVES: ReadonlySet<string> = new Set([
  "list",
  "create",
  "get",
  "update",
  "remove",
  "index",
  "route",
]);

/** Filenames that are never routes. */
export const SKIP_FLOW_FILENAMES: ReadonlySet<string> = new Set([
  "generated.ts",
  "shapes.ts",
  "signals.ts",
]);

/**
 * Convert a filesystem path to POSIX `/` separators.
 *
 * Requirement, not an assumption: `node:path` `join` / `relative` emit `\`
 * on Windows. ESM specifiers and URL stamps are always `/`.
 *
 * @param path - Walked or hand-built path (may contain `\`)
 */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Build an ESM import specifier from a path walked relative to `src/flows`.
 *
 * Always POSIX — even when `walked` used `\`.
 *
 * @param walked - Relative path from the flows directory
 */
export function importSpecifierFromWalked(walked: string): string {
  const posix = toPosixPath(walked).replace(/^\.?\//, "");
  return `./${posix}`;
}

/**
 * True when a file (or its basename) is on the skip list.
 *
 * @param fileName - Basename or relative path
 */
export function isSkipFlowFile(fileName: string): boolean {
  const base = toPosixPath(fileName).split("/").pop() ?? fileName;
  if (base.startsWith("_")) return true;
  if (SKIP_FLOW_FILENAMES.has(base)) return true;
  if (base.endsWith(".test.ts") || base.endsWith(".test.tsx")) return true;
  return false;
}

/**
 * Strip a source path down to the segment after `flows/`.
 *
 * Accepts `notes/[id]/get.ts`, `src/flows/notes/[id]/get.ts`, or an absolute
 * path containing `/flows/`.
 *
 * @param input - Relative or absolute path
 */
export function relFromFlowsDir(input: string): string {
  const posix = toPosixPath(input).replace(/^\.?\//, "");
  const marker = "/flows/";
  const idx = posix.lastIndexOf(marker);
  if (idx >= 0) return posix.slice(idx + marker.length);
  if (posix.startsWith("flows/")) return posix.slice("flows/".length);
  if (posix.startsWith("src/flows/")) return posix.slice("src/flows/".length);
  return posix;
}

/**
 * Infer the HTTP path from a flow file's location under `src/flows`.
 *
 * - `[id]` → `:id`, `[...slug]` → `*`
 * - `(group)` omitted
 * - reserved leaves omit their filename
 * - `main` omits the first URL segment
 * - skip-list files return `undefined`
 *
 * @param relFromFlowsDirOrSource - Path relative to flows or a source file path
 */
export function pathFromFlowFile(relFromFlowsDirOrSource: string): string | undefined {
  const posix = toPosixPath(relFromFlowsDirOrSource);
  const rel = relFromFlowsDir(posix);
  if (!rel) return undefined;

  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;

  const fileName = parts[parts.length - 1]!;
  if (isSkipFlowFile(fileName)) return undefined;
  if (!/\.(ts|tsx|js|jsx)$/.test(fileName)) return undefined;

  const leaf = fileName.replace(/\.(ts|tsx|js|jsx)$/, "");
  const unit = parts[0]!;
  const dirs = parts.slice(1, -1);

  const segments: string[] = [];
  if (unit !== "main") segments.push(unit);

  for (const dir of dirs) {
    if (dir.startsWith("_")) return undefined;
    if (dir.startsWith("(") && dir.endsWith(")")) continue;
    if (dir.startsWith("[[") && dir.endsWith("]]")) return undefined;
    const mapped = mapSegment(dir);
    if (mapped === undefined) return undefined;
    segments.push(mapped);
  }

  if (!RESERVED_LEAVES.has(leaf)) {
    const mapped = mapSegment(leaf);
    if (mapped === undefined) return undefined;
    segments.push(mapped);
  }

  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

/**
 * Infer `unit.export` from a flow file + export name.
 *
 * `[id]` / `(group)` never enter the name.
 *
 * @param filePath - Source path under `flows/`
 * @param exportName - `export const` binding
 */
export function nameFromFlowFile(
  filePath: string,
  exportName: string | undefined,
): string | undefined {
  if (!exportName) return undefined;
  const unit = unitFromFlowFile(filePath);
  if (!unit) return undefined;
  return `${unit}.${exportName}`;
}

/**
 * First-level folder under `src/flows` — the client unit.
 *
 * @param filePath - Source path
 */
export function unitFromFlowFile(filePath: string): string | undefined {
  const rel = relFromFlowsDir(filePath);
  const unit = rel.split("/").filter(Boolean)[0];
  if (!unit) return undefined;
  if (unit.startsWith("[") || unit.startsWith("(") || unit.startsWith("_")) return undefined;
  if (unit.includes(".")) return undefined;
  return unit;
}

/**
 * Map one folder or leaf token to a URL segment.
 *
 * @param token - `[id]`, `[...slug]`, or a static name
 */
function mapSegment(token: string): string | undefined {
  if (token.startsWith("[[") && token.endsWith("]]")) return undefined;
  if (token.startsWith("[...") && token.endsWith("]")) return "*";
  if (token.startsWith("[") && token.endsWith("]")) return `:${token.slice(1, -1)}`;
  return token;
}
