/**
 * Unit tests for request input field projection.
 */

import { describe, expect, test } from "bun:test";
import {
  fieldCopyText,
  inputByteLabel,
  inputFieldRows,
  inputShapeHint,
} from "./request-input-view.ts";

describe("inputFieldRows", () => {
  test("projects plain objects into typed rows", () => {
    expect(
      inputFieldRows({
        bookingId: "bk_8f2a",
        seats: 2,
        ok: true,
        meta: { cabin: "economy" },
      }),
    ).toEqual([
      { key: "bookingId", value: "bk_8f2a", display: "bk_8f2a", kind: "string", children: null },
      { key: "seats", value: 2, display: "2", kind: "number", children: null },
      { key: "ok", value: true, display: "true", kind: "boolean", children: null },
      {
        key: "meta",
        value: { cabin: "economy" },
        display: "cabin: economy",
        kind: "object",
        children: [
          { key: "cabin", value: "economy", display: "economy", kind: "string", children: null },
        ],
      },
    ]);
  });

  test("projects arrays as indexed rows and nests objects", () => {
    expect(inputFieldRows([{ id: "ENG-12", tags: ["sso"] }])).toEqual([
      {
        key: "0",
        value: { id: "ENG-12", tags: ["sso"] },
        display: "id: ENG-12",
        kind: "object",
        children: [
          { key: "id", value: "ENG-12", display: "ENG-12", kind: "string", children: null },
          {
            key: "tags",
            value: ["sso"],
            display: "1 item",
            kind: "array",
            children: [{ key: "0", value: "sso", display: "sso", kind: "string", children: null }],
          },
        ],
      },
    ]);
  });

  test("returns null for scalars, null, and empty arrays", () => {
    expect(inputFieldRows("x")).toBeNull();
    expect(inputFieldRows(null)).toBeNull();
    expect(inputFieldRows([])).toBeNull();
  });

  test("previews nested containers by count when they have no short scalars", () => {
    expect(inputFieldRows({ blob: { nested: { a: 1 } } })?.[0]?.display).toBe("1 field");
  });
});

describe("inputShapeHint", () => {
  test("counts fields and items", () => {
    expect(inputShapeHint({ a: 1, b: 2 })).toBe("2 fields");
    expect(inputShapeHint([1])).toBe("1 item");
  });
});

describe("inputByteLabel", () => {
  test("labels UTF-8 payload size", () => {
    expect(inputByteLabel('{"a":1}')).toBe("7 B");
  });
});

describe("fieldCopyText", () => {
  test("copies strings raw and others as JSON", () => {
    expect(fieldCopyText("hello")).toBe("hello");
    expect(fieldCopyText({ x: 1 })).toBe('{"x":1}');
  });
});
