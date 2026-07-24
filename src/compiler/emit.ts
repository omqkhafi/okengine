/**
 * Write a Manifest to `manifest.oke.json` (or a caller-chosen path).
 */

import type { Manifest } from "../manifest/types.ts";
import { serializeManifest } from "../manifest/validate.ts";

/** Default Manifest artefact filename. */
export const MANIFEST_FILENAME = "manifest.oke.json";

/** Options for {@link emitManifest}. */
export interface EmitManifestOptions {
  /** Destination file path. */
  readonly path: string;
  /** Manifest document to write. */
  readonly manifest: Manifest;
}

/**
 * Serialise and write a Manifest as stable JSON.
 *
 * @param options - Path and document
 * @returns Absolute path written
 */
export async function emitManifest(
  options: EmitManifestOptions,
): Promise<string> {
  const text = serializeManifest(options.manifest);
  await Bun.write(options.path, text);
  return options.path;
}

/**
 * Resolve `manifest.oke.json` under a directory.
 *
 * @param dir - Output directory
 */
export function manifestPathIn(dir: string): string {
  return `${dir.replace(/\/$/, "")}/${MANIFEST_FILENAME}`;
}
