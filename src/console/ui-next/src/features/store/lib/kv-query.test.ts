import { describe, expect, test } from "bun:test";
import { kvSetPatch, lastCommandLine, lastKvStatement, parseKvQuery } from "./kv-query.ts";

describe("parseKvQuery", () => {
  test("empty and comments list the whole store", () => {
    expect(parseKvQuery("")).toEqual({ kind: "list", prefix: "" });
    expect(parseKvQuery("// list [prefix]\n# skip\n")).toEqual({ kind: "list", prefix: "" });
  });

  test("list with and without a prefix", () => {
    expect(parseKvQuery("list")).toEqual({ kind: "list", prefix: "" });
    expect(parseKvQuery("list holds:")).toEqual({ kind: "list", prefix: "holds:" });
  });

  test("get requires a key", () => {
    expect(parseKvQuery("get holds:abc")).toEqual({ kind: "get", key: "holds:abc" });
    expect(parseKvQuery("get")).toEqual({
      kind: "error",
      message: "get requires a key.",
    });
  });

  test("bare token is a list prefix", () => {
    expect(parseKvQuery("holds:")).toEqual({ kind: "list", prefix: "holds:" });
  });

  test("uses the last executable line", () => {
    expect(parseKvQuery("list a:\n// note\nget a:1")).toEqual({ kind: "get", key: "a:1" });
  });

  test("parses a multiline set from Pending Changes", () => {
    const text = `// Update drafts:DES-202
set("drafts:DES-202", {
  "identifier": "DES-200",
  "title": "Sub-issue auto-complete parent (DES-202)",
  "expiresAt": "2026-08-14T02:00:00Z"
})`;
    expect(parseKvQuery(text)).toEqual({
      kind: "set",
      key: "drafts:DES-202",
      keepValue: false,
      value: {
        identifier: "DES-200",
        title: "Sub-issue auto-complete parent (DES-202)",
        expiresAt: "2026-08-14T02:00:00Z",
      },
    });
  });

  test("parses set with TTL and keep-value identifier", () => {
    expect(parseKvQuery('set("drafts:a", { "n": 2 }, "10m")')).toEqual({
      kind: "set",
      key: "drafts:a",
      keepValue: false,
      value: { n: 2 },
      ttl: "10m",
    });
    expect(parseKvQuery('set("drafts:a", value, "30m")')).toEqual({
      kind: "set",
      key: "drafts:a",
      keepValue: true,
      ttl: "30m",
    });
    expect(parseKvQuery('set("drafts:a", value)')).toEqual({
      kind: "set",
      key: "drafts:a",
      keepValue: true,
      ttl: null,
    });
  });

  test("rejects a bare closing brace as a list prefix when set is present", () => {
    expect(parseKvQuery('set("k", {\n  "n": 1\n})').kind).toBe("set");
  });

  test("accepts call form for list and get", () => {
    expect(parseKvQuery("list()")).toEqual({ kind: "list", prefix: "" });
    expect(parseKvQuery('list("holds:")')).toEqual({ kind: "list", prefix: "holds:" });
    expect(parseKvQuery('get("holds:abc")')).toEqual({ kind: "get", key: "holds:abc" });
  });

  test("parses delete and ttl in word and call form", () => {
    expect(parseKvQuery("delete drafts:a")).toEqual({ kind: "delete", key: "drafts:a" });
    expect(parseKvQuery('delete("drafts:a")')).toEqual({ kind: "delete", key: "drafts:a" });
    expect(parseKvQuery("ttl drafts:a")).toEqual({ kind: "ttl", key: "drafts:a" });
    expect(parseKvQuery('ttl("drafts:a")')).toEqual({ kind: "ttl", key: "drafts:a" });
    expect(parseKvQuery("delete")).toEqual({
      kind: "error",
      message: "delete requires a key.",
    });
    expect(parseKvQuery("ttl")).toEqual({
      kind: "error",
      message: "ttl requires a key.",
    });
  });
});

describe("kvSetPatch", () => {
  test("omits value when keeping the current payload", () => {
    expect(kvSetPatch({ kind: "set", key: "a", keepValue: true, ttl: "30m" })).toEqual({
      ttl: "30m",
    });
    expect(kvSetPatch({ kind: "set", key: "a", keepValue: true, ttl: null })).toEqual({
      ttl: null,
    });
  });

  test("writes value and preserves TTL when omitted", () => {
    expect(kvSetPatch({ kind: "set", key: "a", keepValue: false, value: { n: 1 } })).toEqual({
      value: { n: 1 },
    });
  });
});

describe("lastCommandLine", () => {
  test("skips blanks and comments", () => {
    expect(lastCommandLine("list\n\n-- done")).toBe("list");
    expect(lastCommandLine("   ")).toBeNull();
  });
});

describe("lastKvStatement", () => {
  test("takes a multiline set from the last command start", () => {
    expect(lastKvStatement('list drafts:\nset("a", {\n  "n": 1\n})')).toBe(
      'set("a", {\n  "n": 1\n})',
    );
  });
});
