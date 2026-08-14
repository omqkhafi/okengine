import { describe, expect, test } from "bun:test";
import {
  coerceSafeFileObjectKey,
  contentAddressedKey,
  fileKeyWarnings,
  inferFileContentType,
  isAsciiObjectKey,
  projectFileKeys,
  safeFileObjectKey,
  safeFilePrefix,
  slugFileSegment,
} from "./files-policy.ts";

describe("files-policy", () => {
  test("flags non-ASCII keys for signed-URL risk", () => {
    const warnings = fileKeyWarnings("фото/id.jpg");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("non_ascii_key");
  });

  test("ascii keys produce no warnings", () => {
    expect(fileKeyWarnings("a/b/c.png")).toEqual([]);
  });

  test("contentAddressedKey is stable sha256 hex", async () => {
    const a = await contentAddressedKey("hello");
    const b = await contentAddressedKey("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("projectFileKeys attaches warnings per key", () => {
    const rows = projectFileKeys(["ok.txt", "café.bin"]);
    expect(rows[0]?.warnings).toEqual([]);
    expect(rows[1]?.warnings[0]?.code).toBe("non_ascii_key");
  });

  test("safeFileObjectKey is ASCII and keeps a safe extension", () => {
    expect(isAsciiObjectKey("attachments/DES-200/note.txt")).toBe(true);
    expect(isAsciiObjectKey("вложения/shot.png")).toBe(false);
    expect(slugFileSegment("screenshot")).toBe("screenshot");
    expect(slugFileSegment("вложения")).toBe("file");
    expect(safeFilePrefix("вложения/SUP-12/")).toBe("folder/SUP-12/");
    expect(safeFilePrefix("attachments/DES-200/")).toBe("attachments/DES-200/");
    const key = safeFileObjectKey("صبحي احمد موسي يحيي - رخصة عمل.pdf", "attachments/DES-200/");
    expect(isAsciiObjectKey(key)).toBe(true);
    expect(key.startsWith("attachments/DES-200/file-")).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(coerceSafeFileObjectKey("docs/readme.txt")).toBe("docs/readme.txt");
    const coerced = coerceSafeFileObjectKey("вложения/shot.png");
    expect(isAsciiObjectKey(coerced)).toBe(true);
    expect(coerceSafeFileObjectKey("вложения/shot.png")).toBe(coerced);
  });

  test("inferFileContentType maps suffixes", () => {
    expect(inferFileContentType("a/b/shot.png")).toBe("image/png");
    expect(inferFileContentType("note.txt")).toBe("text/plain");
    expect(inferFileContentType("clip.mp4")).toBe("video/mp4");
    expect(inferFileContentType("take.mp3")).toBe("audio/mpeg");
    expect(inferFileContentType("blob")).toBe("application/octet-stream");
  });
});
