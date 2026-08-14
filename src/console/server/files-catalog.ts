/**
 * Files object catalog — original name and metadata next to the bytes.
 *
 * Lives at `.oke/catalog.json` in the same bucket so Console (and any
 * driver) can show Unicode display names while object keys stay ASCII.
 */

import type { FilesStoreFxHandle } from "../../elements/store/runtime.ts";
import { inferFileContentType } from "../../elements/store/files-policy.ts";

/** Reserved catalog object. Hidden from the folder browser. */
export const FILES_CATALOG_KEY = ".oke/catalog.json";

/** One catalog row for a stored object. */
export interface FileObjectRecord {
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}

/** Catalog document version 1. */
export interface FilesCatalog {
  readonly version: 1;
  readonly objects: Readonly<Record<string, FileObjectRecord>>;
}

/**
 * True when the key is Console catalog / reserved (not an operator object).
 *
 * @param key - Object key
 */
export function isFilesCatalogKey(key: string): boolean {
  return key === FILES_CATALOG_KEY || key.startsWith(".oke/");
}

/**
 * Load the catalog. Missing or corrupt → empty.
 *
 * @param handle - Files handle
 */
export async function readFilesCatalog(handle: FilesStoreFxHandle): Promise<FilesCatalog> {
  const data = await handle.get(FILES_CATALOG_KEY);
  if (!data) return { version: 1, objects: {} };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<FilesCatalog>;
    if (
      parsed.version !== 1 ||
      parsed.objects === undefined ||
      typeof parsed.objects !== "object"
    ) {
      return { version: 1, objects: {} };
    }
    return { version: 1, objects: parsed.objects };
  } catch {
    return { version: 1, objects: {} };
  }
}

/**
 * Upsert one object record and persist the catalog.
 *
 * @param handle - Files handle
 * @param key - Safe object key
 * @param record - Display metadata
 */
export async function upsertFilesCatalogRecord(
  handle: FilesStoreFxHandle,
  key: string,
  record: FileObjectRecord,
): Promise<void> {
  const catalog = await readFilesCatalog(handle);
  const next: FilesCatalog = {
    version: 1,
    objects: { ...catalog.objects, [key]: record },
  };
  await handle.put(FILES_CATALOG_KEY, JSON.stringify(next));
}

/**
 * Drop catalog rows for deleted keys.
 *
 * @param handle - Files handle
 * @param keys - Removed object keys
 */
export async function removeFilesCatalogRecords(
  handle: FilesStoreFxHandle,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const catalog = await readFilesCatalog(handle);
  const objects = { ...catalog.objects };
  let changed = false;
  for (const key of keys) {
    if (key in objects) {
      delete objects[key];
      changed = true;
    }
  }
  if (!changed) return;
  await handle.put(FILES_CATALOG_KEY, JSON.stringify({ version: 1, objects }));
}

/**
 * Build a catalog record from a put.
 *
 * @param originalName - Display name
 * @param sizeBytes - Byte length
 * @param key - Safe object key (for MIME fallback)
 */
export function fileObjectRecord(
  originalName: string,
  sizeBytes: number,
  key: string,
): FileObjectRecord {
  return {
    originalName,
    contentType: inferFileContentType(originalName.includes(".") ? originalName : key),
    sizeBytes,
    updatedAt: new Date().toISOString(),
  };
}
