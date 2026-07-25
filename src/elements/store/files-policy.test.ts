import { describe, expect, test } from "bun:test";
import {
  contentAddressedKey,
  fileKeyWarnings,
  projectFileKeys,
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
});
