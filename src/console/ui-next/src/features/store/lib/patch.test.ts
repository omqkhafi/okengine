import { describe, expect, test } from "bun:test";
import {
  isStorePiiMask,
  parseStoreCellDraft,
  sanitizeStorePatch,
  STORE_PII_MASK,
} from "./patch.ts";

describe("sanitizeStorePatch", () => {
  test("strips PII mask placeholder values", () => {
    const patch = {
      email: STORE_PII_MASK,
      seats: 3,
      flight_id: "SK-441",
    };
    expect(sanitizeStorePatch(patch)).toEqual({ seats: 3, flight_id: "SK-441" });
  });

  test("keeps real values that merely contain the mask text", () => {
    const patch = { note: `was ${STORE_PII_MASK} now set` };
    expect(sanitizeStorePatch(patch)).toEqual(patch);
  });

  test("isStorePiiMask detects the exact placeholder", () => {
    expect(isStorePiiMask(STORE_PII_MASK)).toBe(true);
    expect(isStorePiiMask("redacted")).toBe(false);
    expect(isStorePiiMask(null)).toBe(false);
  });
});

describe("parseStoreCellDraft", () => {
  test("integer truncates floats and falls back to raw text", () => {
    expect(parseStoreCellDraft("integer", "42.9")).toBe(42);
    expect(parseStoreCellDraft("integer", "-7")).toBe(-7);
    expect(parseStoreCellDraft("integer", "abc")).toBe("abc");
  });

  test("number keeps floats and falls back to raw text", () => {
    expect(parseStoreCellDraft("number", "3.14")).toBe(3.14);
    expect(parseStoreCellDraft("number", "nope")).toBe("nope");
  });

  test("json parses valid JSON and keeps invalid text as string", () => {
    expect(parseStoreCellDraft("json", '{"a":1}')).toEqual({ a: 1 });
    expect(parseStoreCellDraft("json", "[1,2]")).toEqual([1, 2]);
    expect(parseStoreCellDraft("json", "{broken")).toBe("{broken");
  });

  test("string passes through unchanged", () => {
    expect(parseStoreCellDraft("string", "SK-902")).toBe("SK-902");
  });
});
