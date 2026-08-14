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
 * True when every character is printable ASCII and the key has no `..`.
 *
 * @param key - Object key
 */
export function isAsciiObjectKey(key: string): boolean {
  if (key.length === 0 || key.startsWith("/") || key.includes("..")) return false;
  // eslint-disable-next-line no-control-regex -- printable ASCII only
  return /^[\x20-\x7E]+$/.test(key);
}

/**
 * Slug one path segment to `[a-z0-9._-]`. Empty after strip → `fallback`.
 *
 * @param name - File or folder name
 * @param fallback - Used when nothing ASCII remains
 */
export function slugFileSegment(name: string, fallback = "file"): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

/**
 * ASCII prefix (`вложения/SUP-12/` → `folder/sup-12/`).
 *
 * @param prefix - Folder prefix
 */
export function safeFilePrefix(prefix: string): string {
  const parts = prefix
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  return `${parts.map((part) => (isAsciiObjectKey(part) ? part : slugFileSegment(part, "folder"))).join("/")}/`;
}

function asciiExtension(name: string): string {
  const base = name.replace(/\/+$/, "");
  const slash = base.lastIndexOf("/");
  const file = slash === -1 ? base : base.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return "";
  const ext = file.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? `.${ext}` : "";
}

function shortId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function idFromKey(requested: string): string {
  let hash = 2166136261;
  for (let i = 0; i < requested.length; i++) {
    hash ^= requested.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * URL-safe object key from a display name. Non-ASCII folders and names
 * become slugs; a short id avoids collisions (`file-a1b2c3d4.pdf`).
 *
 * @param originalName - Operator-facing file name (Unicode OK)
 * @param prefix - Folder prefix (ASCII segments kept as-is)
 * @param id - Optional 8-hex suffix; generated when omitted
 */
export function safeFileObjectKey(originalName: string, prefix = "", id = shortId()): string {
  const ext = asciiExtension(originalName);
  const trimmed = originalName.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const file = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  const stem = ext.length > 0 ? file.slice(0, -ext.length) : file;
  return `${safeFilePrefix(prefix)}${slugFileSegment(stem)}-${id}${ext}`;
}

/**
 * Keep an already-safe key; otherwise build one from the last segment.
 *
 * @param requestedKey - Key the operator typed or the browser sent
 */
export function coerceSafeFileObjectKey(requestedKey: string): string {
  if (isAsciiObjectKey(requestedKey)) return requestedKey;
  const slash = requestedKey.lastIndexOf("/");
  const prefix = slash === -1 ? "" : requestedKey.slice(0, slash + 1);
  const name = slash === -1 ? requestedKey : requestedKey.slice(slash + 1);
  return safeFileObjectKey(name, prefix, idFromKey(requestedKey));
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

const FILE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/plain",
  pdf: "application/pdf",
  patch: "text/x-patch",
  diff: "text/x-patch",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
};

/**
 * MIME type from an object key suffix. Unknown → `application/octet-stream`.
 *
 * @param key - Object key
 */
export function inferFileContentType(key: string): string {
  const base = key.replace(/\/+$/, "");
  const slash = base.lastIndexOf("/");
  const name = slash === -1 ? base : base.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "application/octet-stream";
  const ext = name.slice(dot + 1).toLowerCase();
  return FILE_MIME[ext] ?? "application/octet-stream";
}
