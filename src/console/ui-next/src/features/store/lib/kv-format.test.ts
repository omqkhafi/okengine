/**
 * Unit tests for KV console pretty-print.
 */

import { describe, expect, test } from "bun:test";
import { formatKvCommand, prettifyKv } from "./kv-format.ts";

describe("prettifyKv", () => {
  test("returns empty for blank input", () => {
    expect(prettifyKv("   \n")).toBe("");
  });

  test("keeps comments and formats list / get", () => {
    expect(prettifyKv("// list  ·  get\nlist holds:")).toBe(
      '// list  ·  get\nlist("holds:")',
    );
    expect(prettifyKv("get drafts:a")).toBe('get("drafts:a")');
  });

  test("pretty-prints a compact set object", () => {
    expect(prettifyKv('set("drafts:a", {"n":1,"title":"x"})')).toBe(
      `set("drafts:a", {\n  "n": 1,\n  "title": "x"\n})`,
    );
  });

  test("keeps set TTL and the value identifier", () => {
    expect(prettifyKv('set("drafts:a", value, "30m")')).toBe(
      'set("drafts:a", value, "30m")',
    );
    expect(prettifyKv('set("drafts:a", { "n": 2 }, "10m")')).toBe(
      `set("drafts:a", {\n  "n": 2\n}, "10m")`,
    );
  });

  test("leaves an unparseable statement alone", () => {
    expect(prettifyKv("set(oops")).toBe("set(oops");
  });

  test("keeps a comment after a multiline set", () => {
    expect(prettifyKv('set("k", {"n":1})\n// keep')).toBe(
      `set("k", {\n  "n": 1\n})\n// keep`,
    );
  });
});

describe("formatKvCommand", () => {
  test("formats list without a prefix as list()", () => {
    expect(formatKvCommand({ kind: "list", prefix: "" })).toBe("list()");
  });
});
