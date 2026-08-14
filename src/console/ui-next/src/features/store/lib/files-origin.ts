/**
 * Files bucket identity — Manifest name + driver origin.
 *
 * A bucket is declared on `store.files(name, { buckets })`. When `buckets`
 * is omitted, the store name is the one bucket. Bytes live on the files
 * driver for this environment: `memory` (this process), `fs` (local disk),
 * or `s3` (object store).
 */

import type { StoreListStore } from "@/client.ts";

/** Files driver ids the Console can surface. */
export type FilesDriverId = "memory" | "fs" | "s3";

/**
 * True when the store is one bucket that shares the store name.
 * The tree should show a single leaf — not `attachments` → `attachments`.
 *
 * @param store - Projected store row
 */
export function isSingletonFilesBucket(store: StoreListStore): boolean {
  if (store.facet !== "files") return false;
  const only = store.children[0];
  return store.children.length === 1 && only !== undefined && only.name === store.name;
}

/**
 * Short driver chip (`memory` / `fs` / `s3`).
 *
 * @param driverId - Files driver, if known
 */
export function filesDriverLabel(driverId: string | undefined): string {
  if (driverId === "memory" || driverId === "fs" || driverId === "s3") return driverId;
  return "files";
}

/**
 * Where the bucket's bytes live.
 *
 * @param driverId - Files driver, if known
 */
export function filesDriverOrigin(driverId: string | undefined): string {
  switch (driverId) {
    case "memory":
      return "This process";
    case "fs":
      return "Local disk";
    case "s3":
      return "Object store";
    default:
      return "Files driver";
  }
}
