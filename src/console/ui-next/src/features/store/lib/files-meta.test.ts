import { describe, expect, test } from "bun:test";
import {
  fileExtension,
  fileKindFromName,
  fileKindIsImage,
  fileKindIsText,
  fileKindLabel,
  fileNameFromKey,
  filePreviewMode,
  formatFilePreviewText,
  previewBlobType,
  inferContentType,
  isAsciiObjectKey,
  safeFileObjectKey,
} from "./files-meta.ts";

describe("safeFileObjectKey", () => {
  test("re-export mints an ASCII key with a stable id", () => {
    const key = safeFileObjectKey("رخصة عمل.pdf", "attachments/DES-200/", "ab12cd34");
    expect(isAsciiObjectKey(key)).toBe(true);
    expect(key).toBe("attachments/DES-200/file-ab12cd34.pdf");
  });
});

describe("fileNameFromKey", () => {
  test("last segment, trailing slashes ignored", () => {
    expect(fileNameFromKey("attachments/ENG-184/spec.pdf")).toBe("spec.pdf");
    expect(fileNameFromKey("spec.pdf")).toBe("spec.pdf");
    expect(fileNameFromKey("folder/")).toBe("folder");
  });
});

describe("fileExtension", () => {
  test("lowercase suffix; empty when missing or leading-dot", () => {
    expect(fileExtension("spec.PDF")).toBe("pdf");
    expect(fileExtension("a/b/pr-diff.patch")).toBe("patch");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});

describe("fileKindFromName", () => {
  test("maps common suffixes", () => {
    expect(fileKindFromName("shot.png")).toBe("image");
    expect(fileKindFromName("note.txt")).toBe("text");
    expect(fileKindFromName("app.ts")).toBe("code");
    expect(fileKindFromName("spec.pdf")).toBe("pdf");
    expect(fileKindFromName("clip.mp4")).toBe("video");
    expect(fileKindFromName("take.mp3")).toBe("audio");
    expect(fileKindFromName("pr.diff")).toBe("patch");
    expect(fileKindFromName("out.zip")).toBe("archive");
    expect(fileKindFromName("blob")).toBe("binary");
  });
});

describe("inferContentType", () => {
  test("known MIME, octet-stream fallback", () => {
    expect(inferContentType("a.webp")).toBe("image/webp");
    expect(inferContentType("a.json")).toBe("application/json");
    expect(inferContentType("a.bin")).toBe("application/octet-stream");
  });
});

describe("fileKind helpers", () => {
  test("labels and preview flags", () => {
    expect(fileKindLabel("pdf")).toBe("PDF");
    expect(fileKindIsText("code")).toBe(true);
    expect(fileKindIsText("image")).toBe(false);
    expect(fileKindIsImage("image")).toBe(true);
    expect(previewBlobType("pdf", "application/octet-stream")).toBe("application/pdf");
    expect(previewBlobType("image", "image/png")).toBe("image/png");
    expect(filePreviewMode("pdf")).toBe("pdf");
    expect(filePreviewMode("video")).toBe("video");
    expect(filePreviewMode("archive")).toBe("none");
    expect(formatFilePreviewText('{"a":1}', "data.json")).toBe('{\n  "a": 1\n}');
    expect(formatFilePreviewText("not-json", "data.json")).toBe("not-json");
  });
});
