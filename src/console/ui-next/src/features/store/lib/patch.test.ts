import { describe, expect, test } from "bun:test";
import {
  buildInsertPatch,
  defaultInsertDraft,
  insertFormColumns,
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

  test("boolean accepts true / false tokens", () => {
    expect(parseStoreCellDraft("boolean", "true")).toBe(true);
    expect(parseStoreCellDraft("boolean", "off")).toBe(false);
  });
});

describe("buildInsertPatch", () => {
  const columns = [
    { key: "id", type: "string" as const },
    { key: "seats", type: "integer" as const },
    { key: "email", type: "string" as const },
  ];

  test("omits empty fields and parses integers", () => {
    const result = buildInsertPatch(columns, {
      id: "b2",
      seats: "4",
      email: "",
    });
    expect(result).toEqual({ ok: true, patch: { id: "b2", seats: 4 } });
  });

  test("requires id", () => {
    expect(buildInsertPatch(columns, { id: "", seats: "2" })).toEqual({
      ok: false,
      error: "id is required",
    });
  });

  test("defaultInsertDraft seeds a UUID id", () => {
    const draft = defaultInsertDraft(columns);
    expect(draft.id?.length).toBeGreaterThan(8);
    expect(draft.seats).toBe("");
    expect(draft.email).toBe("");
  });

  test("insertFormColumns prepends id when missing", () => {
    expect(insertFormColumns([{ key: "seats", type: "integer" }]).map((c) => c.key)).toEqual([
      "id",
      "seats",
    ]);
    expect(insertFormColumns(columns)).toEqual(columns);
  });
});
