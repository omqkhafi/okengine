/**
 * Files browse metadata — kind, MIME, and labels from an object key.
 */

export {
  coerceSafeFileObjectKey,
  isAsciiObjectKey,
  safeFileObjectKey,
} from "../../../../../../elements/store/files-policy.ts";

/** Operator-facing object kind inferred from the key suffix. */
export type FileKind =
  | "image"
  | "text"
  | "code"
  | "pdf"
  | "patch"
  | "video"
  | "audio"
  | "archive"
  | "binary";

/** How the inspector should render a kind. */
export type FilePreviewMode = "image" | "text" | "pdf" | "video" | "audio" | "none";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const TEXT = new Set([
  "txt",
  "md",
  "csv",
  "tsv",
  "log",
  "json",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
]);
const CODE = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "html",
  "htm",
  "sql",
  "go",
  "rs",
  "py",
  "rb",
  "sh",
  "bash",
  "zsh",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "swift",
  "proto",
  "graphql",
  "vue",
  "svelte",
]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "oga"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "tgz", "7z"]);

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  log: "text/plain",
  json: "application/json",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  toml: "text/plain",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  sql: "text/plain",
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
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
};

/**
 * Last path segment of an object key (`a/b/c.pdf` → `c.pdf`).
 *
 * @param key - Object key
 */
export function fileNameFromKey(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * Lowercase extension without the dot (`spec.pdf` → `pdf`).
 *
 * @param name - File name or key
 */
export function fileExtension(name: string): string {
  const base = fileNameFromKey(name);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Infer a browse kind from the key suffix.
 *
 * @param name - File name or key
 */
export function fileKindFromName(name: string): FileKind {
  const ext = fileExtension(name);
  if (ext === "pdf") return "pdf";
  if (ext === "patch" || ext === "diff") return "patch";
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (ARCHIVE.has(ext)) return "archive";
  if (CODE.has(ext)) return "code";
  if (TEXT.has(ext)) return "text";
  return "binary";
}

/**
 * MIME type for preview / download. Unknown suffixes → `application/octet-stream`.
 *
 * @param name - File name or key
 */
export function inferContentType(name: string): string {
  const ext = fileExtension(name);
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * Short label for a {@link FileKind}.
 *
 * @param kind - Inferred kind
 */
export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "text":
      return "Text";
    case "code":
      return "Code";
    case "pdf":
      return "PDF";
    case "patch":
      return "Patch";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "archive":
      return "Archive";
    case "binary":
      return "Binary";
  }
}

/**
 * Whether the kind can render as UTF-8 in the inspector.
 *
 * @param kind - Inferred kind
 */
export function fileKindIsText(kind: FileKind): boolean {
  return kind === "text" || kind === "code" || kind === "patch";
}

/**
 * Whether the kind can render as an `<img>` in the inspector.
 *
 * @param kind - Inferred kind
 */
export function fileKindIsImage(kind: FileKind): boolean {
  return kind === "image";
}

/**
 * Inspector surface for a kind (`none` → download fallback).
 *
 * @param kind - Inferred kind
 */
export function filePreviewMode(kind: FileKind): FilePreviewMode {
  switch (kind) {
    case "image":
      return "image";
    case "text":
    case "code":
    case "patch":
      return "text";
    case "pdf":
      return "pdf";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "none";
  }
}

/**
 * Pretty-print JSON; leave other text as stored.
 *
 * @param text - UTF-8 body
 * @param name - File name or key
 */
export function formatFilePreviewText(text: string, name: string): string {
  if (fileExtension(name) !== "json") return text;
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}
