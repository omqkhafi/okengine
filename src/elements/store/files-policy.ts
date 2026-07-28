/**
 * Files facet operational policy — content-addressed keys + driver warnings.
 *
 * Warnings are generated here (element physics) so the Console surfaces them
 * automatically rather than inventing hand-written copy (console §9.5 · §11).
 */

/** One operational warning attached to a files key. */
export interface FileKeyWarning {
  /** Stable machine code. */
  readonly code: "non_ascii_key";
  /** Human-readable operator message. */
  readonly message: string;
  /** Object key that triggered the warning. */
  readonly key: string;
}

/**
 * Operational warnings for a files object key.
 *
 * Non-ASCII keys break signed-URL percent-encoding on S3-compatible stores.
 *
 * @param key - Object key
 */
export function fileKeyWarnings(key: string): readonly FileKeyWarning[] {
  const warnings: FileKeyWarning[] = [];
  // eslint-disable-next-line no-control-regex -- intentional: detect non-ASCII
  if (/[^\x00-\x7F]/.test(key)) {
    warnings.push({
      code: "non_ascii_key",
      message: "Non-ASCII object key — signed URL encoding may break on S3-compatible stores.",
      key,
    });
  }
  return warnings;
}

/**
 * Content-addressed object key (sha256 hex of bytes).
 *
 * @param data - Object bytes or UTF-8 string
 */
export async function contentAddressedKey(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Attach warnings to a list of object keys.
 *
 * @param keys - Object keys from the driver
 */
export function projectFileKeys(keys: readonly string[]): ReadonlyArray<{
  readonly key: string;
  readonly warnings: readonly FileKeyWarning[];
}> {
  return keys.map((key) => ({
    key,
    warnings: fileKeyWarnings(key),
  }));
}
