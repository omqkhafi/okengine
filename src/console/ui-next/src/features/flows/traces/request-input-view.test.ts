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
      { key: "bookingId", value: "bk_8f2a", display: "bk_8f2a", kind: "string" },
      { key: "seats", value: 2, display: "2", kind: "number" },
      { key: "ok", value: true, display: "true", kind: "boolean" },
      {
        key: "meta",
        value: { cabin: "economy" },
        display: '{"cabin":"economy"}',
        kind: "object",
      },
    ]);
  });

  test("returns null for arrays and scalars", () => {
    expect(inputFieldRows(["a"])).toBeNull();
    expect(inputFieldRows("x")).toBeNull();
    expect(inputFieldRows(null)).toBeNull();
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
