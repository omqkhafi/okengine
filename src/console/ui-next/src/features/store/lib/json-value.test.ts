import { describe, expect, test } from "bun:test";
import {
  asInspectableJson,
  fieldDraftText,
  jsonFieldRows,
  jsonValueEqual,
  parseInspectableJsonText,
  parseJsonFieldDraft,
  prettyJsonCell,
  setJsonField,
} from "./json-value.ts";

describe("asInspectableJson", () => {
  test("keeps parsed objects and arrays", () => {
    expect(asInspectableJson({ identifier: "DES-202" })).toEqual({ identifier: "DES-202" });
    expect(asInspectableJson([1, 2])).toEqual([1, 2]);
  });

  test("parses JSON object and array strings", () => {
    expect(asInspectableJson('{"title":"Draft"}')).toEqual({ title: "Draft" });
    expect(asInspectableJson("  [1, 2]  ")).toEqual([1, 2]);
  });

  test("rejects primitives and invalid JSON", () => {
    expect(asInspectableJson(null)).toBeNull();
    expect(asInspectableJson("hello")).toBeNull();
    expect(asInspectableJson("42")).toBeNull();
    expect(asInspectableJson("{not json")).toBeNull();
    expect(asInspectableJson('"just a string"')).toBeNull();
  });
});

describe("jsonFieldRows", () => {
  test("flattens a KV object into field rows", () => {
    expect(
      jsonFieldRows({
        identifier: "DES-202",
        title: "Sub-issue",
        expiresAt: "2026-08-14T02:00:00Z",
      }),
    ).toEqual([
      { path: "identifier", value: "DES-202", kind: "string" },
      { path: "title", value: "Sub-issue", kind: "string" },
      { path: "expiresAt", value: "2026-08-14T02:00:00Z", kind: "string" },
    ]);
  });

  test("flattens nested objects and arrays", () => {
    expect(
      jsonFieldRows({
        user: { id: 1, name: "Ali" },
        tags: ["a", "b"],
        empty: {},
        none: [],
      }),
    ).toEqual([
      { path: "user.id", value: 1, kind: "number" },
      { path: "user.name", value: "Ali", kind: "string" },
      { path: "tags[0]", value: "a", kind: "string" },
      { path: "tags[1]", value: "b", kind: "string" },
      { path: "empty", value: {}, kind: "object" },
      { path: "none", value: [], kind: "array" },
    ]);
  });

  test("indexes a root array of objects", () => {
    expect(jsonFieldRows([{ id: "a" }, { id: "b" }])).toEqual([
      { path: "[0].id", value: "a", kind: "string" },
      { path: "[1].id", value: "b", kind: "string" },
    ]);
  });

  test("empty roots and non-JSON yield no rows", () => {
    expect(jsonFieldRows({})).toEqual([]);
    expect(jsonFieldRows([])).toEqual([]);
    expect(jsonFieldRows("plain")).toEqual([]);
  });
});

describe("parseInspectableJsonText", () => {
  test("accepts objects and arrays, rejects empty / primitives / invalid", () => {
    expect(parseInspectableJsonText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseInspectableJsonText("[1]")).toEqual({ ok: true, value: [1] });
    expect(parseInspectableJsonText("")).toEqual({ ok: false, error: "JSON is empty" });
    expect(parseInspectableJsonText("42")).toEqual({
      ok: false,
      error: "JSON must be an object or array",
    });
    expect(parseInspectableJsonText("{")).toEqual({ ok: false, error: "Invalid JSON" });
  });
});

describe("prettyJsonCell", () => {
  test("pretty-prints parsed and string JSON", () => {
    expect(prettyJsonCell({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJsonCell('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
});

describe("setJsonField", () => {
  test("writes nested object and array paths without mutating root", () => {
    const root = { user: { id: 1, name: "Ali" }, tags: ["a", "b"] };
    const next = setJsonField(root, "user.name", "Sam");
    expect(next).toEqual({ user: { id: 1, name: "Sam" }, tags: ["a", "b"] });
    expect(root.user.name).toBe("Ali");
    expect(setJsonField(root, "tags[1]", "c")).toEqual({
      user: { id: 1, name: "Ali" },
      tags: ["a", "c"],
    });
  });

  test("writes through a root array", () => {
    expect(setJsonField([{ id: "a" }, { id: "b" }], "[1].id", "c")).toEqual([
      { id: "a" },
      { id: "c" },
    ]);
  });
});

describe("parseJsonFieldDraft", () => {
  test("keeps strings and coerces numbers / booleans / null", () => {
    expect(parseJsonFieldDraft("string", "DES-202")).toBe("DES-202");
    expect(parseJsonFieldDraft("number", "12")).toBe(12);
    expect(parseJsonFieldDraft("number", "")).toBeNull();
    expect(parseJsonFieldDraft("boolean", "false")).toBe(false);
    expect(parseJsonFieldDraft("null", "")).toBeNull();
    expect(parseJsonFieldDraft("null", "hello")).toBe("hello");
    expect(parseJsonFieldDraft("object", '{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonFieldDraft("array", "")).toEqual([]);
  });
});

describe("fieldDraftText / jsonValueEqual", () => {
  test("renders empty containers and compares by JSON", () => {
    expect(fieldDraftText({}, "object")).toBe("{}");
    expect(fieldDraftText([], "array")).toBe("[]");
    expect(fieldDraftText(true, "boolean")).toBe("true");
    expect(jsonValueEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(jsonValueEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
