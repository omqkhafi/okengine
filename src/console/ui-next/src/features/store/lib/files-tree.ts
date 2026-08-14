/**
 * Files prefix browser — slash-separated keys become folders + objects.
 */

import { fileNameFromKey } from "./files-meta.ts";

/** One listed object from `QUERY /console/store/query`. */
export type FileKeyRow = {
  readonly key: string;
  readonly sizeBytes?: number;
  readonly originalName?: string;
  readonly warnings?: ReadonlyArray<{ readonly code: string; readonly message: string }>;
};

/** Folder at the current prefix. */
export type FileFolderEntry = {
  readonly kind: "folder";
  readonly name: string;
  /** Prefix to open (`attachments/ENG-184/`). */
  readonly prefix: string;
  readonly objectCount: number;
  readonly sizeBytes: number;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
};

/** Object sitting in the current prefix. */
export type FileObjectEntry = {
  readonly kind: "file";
  readonly name: string;
  readonly key: string;
  readonly sizeBytes: number;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
};

/** One row in the files browser. */
export type FileBrowseEntry = FileFolderEntry | FileObjectEntry;

/** Breadcrumb segment for the current prefix. */
export type FilePrefixCrumb = {
  readonly name: string;
  readonly prefix: string;
};

/**
 * Normalize a folder prefix: empty string or `a/b/` (trailing slash, no leading slash).
 *
 * @param prefix - Raw prefix
 */
export function normalizeFilePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length === 0 ? "" : `${trimmed}/`;
}

/**
 * Parent prefix (`attachments/ENG-184/` → `attachments/`).
 *
 * @param prefix - Current prefix
 */
export function parentFilePrefix(prefix: string): string {
  const normalized = normalizeFilePrefix(prefix);
  if (normalized.length === 0) return "";
  const without = normalized.slice(0, -1);
  const slash = without.lastIndexOf("/");
  return slash === -1 ? "" : `${without.slice(0, slash + 1)}`;
}

/**
 * Join a folder name onto a prefix.
 *
 * @param prefix - Current prefix
 * @param name - Next segment
 */
export function joinFilePrefix(prefix: string, name: string): string {
  const base = normalizeFilePrefix(prefix);
  const segment = name.replace(/^\/+|\/+$/g, "");
  if (segment.length === 0) return base;
  return `${base}${segment}/`;
}

/**
 * Join a file name onto a prefix (`attachments/` + `spec.pdf`).
 *
 * @param prefix - Current prefix
 * @param name - File name
 */
export function joinFileKey(prefix: string, name: string): string {
  const base = normalizeFilePrefix(prefix);
  const file = name.replace(/^\/+/, "");
  return `${base}${file}`;
}

/**
 * Breadcrumb crumbs from bucket root to the current prefix.
 *
 * @param prefix - Current prefix
 */
export function filePrefixCrumbs(prefix: string): FilePrefixCrumb[] {
  const normalized = normalizeFilePrefix(prefix);
  if (normalized.length === 0) return [];
  const parts = normalized.slice(0, -1).split("/");
  const crumbs: FilePrefixCrumb[] = [];
  let acc = "";
  for (const part of parts) {
    acc = `${acc}${part}/`;
    crumbs.push({ name: part, prefix: acc });
  }
  return crumbs;
}

/**
 * Path crumbs under a bucket. Drops a leading folder that repeats the
 * bucket name so the chrome reads `attachments / DES-202`, not
 * `attachments / attachments / DES-202`.
 *
 * @param prefix - Current prefix
 * @param bucketName - Manifest bucket (root crumb)
 */
export function fileBrowserCrumbs(prefix: string, bucketName: string): FilePrefixCrumb[] {
  const crumbs = filePrefixCrumbs(prefix);
  const first = crumbs[0];
  if (first && first.name === bucketName) return crumbs.slice(1);
  return crumbs;
}

/**
 * Split listed keys into folders + files at `prefix`.
 *
 * @param keys - Flat object keys
 * @param prefix - Folder to open
 */
export function browseFileKeys(
  keys: readonly FileKeyRow[],
  prefix: string,
): { readonly folders: FileFolderEntry[]; readonly files: FileObjectEntry[] } {
  const normalized = normalizeFilePrefix(prefix);
  const folders = new Map<
    string,
    {
      name: string;
      prefix: string;
      objectCount: number;
      sizeBytes: number;
      warnings: Array<{ code: string; message: string }>;
    }
  >();
  const files: FileObjectEntry[] = [];

  for (const row of keys) {
    if (normalized.length > 0 && !row.key.startsWith(normalized)) continue;
    const rest = row.key.slice(normalized.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push({
        kind: "file",
        name: row.originalName ?? rest,
        key: row.key,
        sizeBytes: row.sizeBytes ?? 0,
        warnings: row.warnings ?? [],
      });
      continue;
    }
    const name = rest.slice(0, slash);
    if (name.length === 0) continue;
    const folderPrefix = `${normalized}${name}/`;
    const existing = folders.get(folderPrefix);
    const size = row.sizeBytes ?? 0;
    const warnings = [...(row.warnings ?? [])];
    if (existing) {
      existing.objectCount += 1;
      existing.sizeBytes += size;
      existing.warnings.push(...warnings);
    } else {
      folders.set(folderPrefix, {
        name,
        prefix: folderPrefix,
        objectCount: 1,
        sizeBytes: size,
        warnings,
      });
    }
  }

  const folderRows: FileFolderEntry[] = [...folders.values()]
    .map((folder) => ({
      kind: "folder" as const,
      name: folder.name,
      prefix: folder.prefix,
      objectCount: folder.objectCount,
      sizeBytes: folder.sizeBytes,
      warnings: folder.warnings,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders: folderRows, files };
}

/**
 * Flatten keys whose name or path contains `query` (case-insensitive).
 *
 * @param keys - Flat object keys
 * @param query - Free-text filter
 */
export function searchFileKeys(keys: readonly FileKeyRow[], query: string): FileObjectEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  return keys
    .filter((row) => {
      const name = (row.originalName ?? fileNameFromKey(row.key)).toLowerCase();
      return row.key.toLowerCase().includes(needle) || name.includes(needle);
    })
    .map((row) => ({
      kind: "file" as const,
      name: row.originalName ?? fileNameFromKey(row.key),
      key: row.key,
      sizeBytes: row.sizeBytes ?? 0,
      warnings: row.warnings ?? [],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Object keys that live under a folder prefix (for folder delete).
 *
 * @param keys - Flat object keys
 * @param prefix - Folder prefix
 */
export function keysUnderPrefix(keys: readonly FileKeyRow[], prefix: string): string[] {
  const normalized = normalizeFilePrefix(prefix);
  if (normalized.length === 0) return keys.map((row) => row.key);
  return keys.filter((row) => row.key.startsWith(normalized)).map((row) => row.key);
}
