import { describe, expect, test } from "bun:test";
import {
  browseFileKeys,
  fileBrowserCrumbs,
  filePrefixCrumbs,
  joinFileKey,
  joinFilePrefix,
  keysUnderPrefix,
  normalizeFilePrefix,
  parentFilePrefix,
  searchFileKeys,
} from "./files-tree.ts";

const KEYS = [
  { key: "attachments/ENG-184/spec.pdf", sizeBytes: 10 },
  { key: "attachments/ENG-184/pr-diff.patch", sizeBytes: 20 },
  { key: "attachments/DES-200/note-1.txt", sizeBytes: 5 },
  {
    key: "вложения/SUP-12/screenshot.png",
    sizeBytes: 8,
    warnings: [{ code: "non_ascii_key", message: "bad" }],
  },
  { key: "readme.md", sizeBytes: 3 },
  {
    key: "attachments/DES-200/file-ab12.pdf",
    originalName: "رخصة عمل.pdf",
    sizeBytes: 40,
  },
] as const;

describe("normalizeFilePrefix", () => {
  test("empty or trailing-slash form", () => {
    expect(normalizeFilePrefix("")).toBe("");
    expect(normalizeFilePrefix("/")).toBe("");
    expect(normalizeFilePrefix("attachments")).toBe("attachments/");
    expect(normalizeFilePrefix("/attachments/ENG-184/")).toBe("attachments/ENG-184/");
  });
});

describe("parentFilePrefix / join", () => {
  test("walks up and down", () => {
    expect(parentFilePrefix("attachments/ENG-184/")).toBe("attachments/");
    expect(parentFilePrefix("attachments/")).toBe("");
    expect(parentFilePrefix("")).toBe("");
    expect(joinFilePrefix("attachments/", "ENG-184")).toBe("attachments/ENG-184/");
    expect(joinFileKey("attachments/ENG-184/", "spec.pdf")).toBe("attachments/ENG-184/spec.pdf");
  });
});

describe("filePrefixCrumbs", () => {
  test("root is empty; nested prefixes accumulate", () => {
    expect(filePrefixCrumbs("")).toEqual([]);
    expect(filePrefixCrumbs("attachments/ENG-184/")).toEqual([
      { name: "attachments", prefix: "attachments/" },
      { name: "ENG-184", prefix: "attachments/ENG-184/" },
    ]);
  });
});

describe("fileBrowserCrumbs", () => {
  test("drops a leading folder that repeats the bucket name", () => {
    expect(fileBrowserCrumbs("attachments/DES-202/", "attachments")).toEqual([
      { name: "DES-202", prefix: "attachments/DES-202/" },
    ]);
    expect(fileBrowserCrumbs("вложения/SUP-12/", "attachments")).toEqual([
      { name: "вложения", prefix: "вложения/" },
      { name: "SUP-12", prefix: "вложения/SUP-12/" },
    ]);
  });
});

describe("browseFileKeys", () => {
  test("root shows folders + loose files", () => {
    const { folders, files } = browseFileKeys(KEYS, "");
    expect(folders.map((f) => f.name)).toEqual(["attachments", "вложения"]);
    expect(files.map((f) => f.name)).toEqual(["readme.md"]);
    expect(folders[0]?.objectCount).toBe(4);
    expect(folders[0]?.sizeBytes).toBe(75);
    expect(folders[1]?.warnings[0]?.code).toBe("non_ascii_key");
  });

  test("nested prefix lists issue folders then objects", () => {
    const mid = browseFileKeys(KEYS, "attachments/");
    expect(mid.folders.map((f) => f.name)).toEqual(["DES-200", "ENG-184"]);
    expect(mid.files).toEqual([]);

    const leaf = browseFileKeys(KEYS, "attachments/ENG-184/");
    expect(leaf.folders).toEqual([]);
    expect(leaf.files.map((f) => f.name)).toEqual(["pr-diff.patch", "spec.pdf"]);

    const named = browseFileKeys(KEYS, "attachments/DES-200/");
    expect(named.files.map((f) => f.name)).toEqual(["note-1.txt", "رخصة عمل.pdf"]);
    expect(named.files.find((f) => f.name === "رخصة عمل.pdf")?.key).toBe(
      "attachments/DES-200/file-ab12.pdf",
    );
  });
});

describe("searchFileKeys", () => {
  test("matches key substring and keeps the full key", () => {
    const hits = searchFileKeys(KEYS, "eng-184");
    expect(hits.map((h) => h.key)).toEqual([
      "attachments/ENG-184/pr-diff.patch",
      "attachments/ENG-184/spec.pdf",
    ]);
    expect(hits[1]?.name).toBe("spec.pdf");
  });

  test("matches originalName when the object key is ASCII", () => {
    const hits = searchFileKeys(KEYS, "رخصة");
    expect(hits.map((h) => h.key)).toEqual(["attachments/DES-200/file-ab12.pdf"]);
    expect(hits[0]?.name).toBe("رخصة عمل.pdf");
  });
});

describe("keysUnderPrefix", () => {
  test("folder delete collects every descendant key", () => {
    expect(keysUnderPrefix(KEYS, "attachments/ENG-184/")).toEqual([
      "attachments/ENG-184/spec.pdf",
      "attachments/ENG-184/pr-diff.patch",
    ]);
  });
});
