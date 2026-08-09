/**
 * Vault path canonicalization.
 *
 * A path is a slash-separated key with **no** leading or trailing slash:
 * `prod/api/stripe`. Canonicalization runs before every read, write, and
 * audit row so the same logical secret always hashes into the same AAD.
 */

import { VaultError } from "./errors.ts";

/** Maximum canonical path length in UTF-16 code units. */
export const MAX_VAULT_PATH_LENGTH = 512;

/**
 * Normalize and validate a Vault path.
 *
 * Trims surrounding whitespace, strips leading/trailing slashes, and
 * collapses duplicate separators. Rejects empty paths, `..` traversal,
 * NUL bytes, backslashes, and anything longer than
 * {@link MAX_VAULT_PATH_LENGTH}.
 *
 * @param input - Raw path from a caller
 * @throws VaultError `INVALID_PATH` when the path cannot be canonicalized
 */
export function canonicalizePath(input: string): string {
  if (typeof input !== "string") {
    throw new VaultError("INVALID_PATH", "vault: path must be a string");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new VaultError("INVALID_PATH", "vault: path must not be empty");
  }
  if (trimmed.length > MAX_VAULT_PATH_LENGTH) {
    throw new VaultError("INVALID_PATH", `vault: path exceeds ${MAX_VAULT_PATH_LENGTH} characters`);
  }
  if (trimmed.includes("\0")) {
    throw new VaultError("INVALID_PATH", "vault: path must not contain NUL bytes");
  }
  if (trimmed.includes("\\")) {
    throw new VaultError("INVALID_PATH", "vault: path must not contain backslashes");
  }

  const segments: string[] = [];
  for (const raw of trimmed.split("/")) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    if (segment === ".") {
      throw new VaultError("INVALID_PATH", 'vault: path must not contain "." segments');
    }
    if (segment === "..") {
      throw new VaultError("INVALID_PATH", 'vault: path must not contain ".." segments');
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new VaultError("INVALID_PATH", "vault: path must contain at least one segment");
  }

  const canonical = segments.join("/");
  if (canonical.length > MAX_VAULT_PATH_LENGTH) {
    throw new VaultError("INVALID_PATH", `vault: path exceeds ${MAX_VAULT_PATH_LENGTH} characters`);
  }
  return canonical;
}

/**
 * Canonicalize a prefix filter for list queries.
 *
 * Unlike {@link canonicalizePath}, an empty prefix is legal and means
 * "every path".
 *
 * @param input - Raw prefix, or `undefined` for no filter
 */
export function canonicalizePrefix(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed === "/") return undefined;
  return canonicalizePath(trimmed);
}

/**
 * Whether a canonical path sits under a canonical prefix.
 *
 * @param path - Canonical path
 * @param prefix - Canonical prefix
 */
export function pathHasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
