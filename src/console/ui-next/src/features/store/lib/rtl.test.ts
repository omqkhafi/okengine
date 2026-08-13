import { describe, expect, test } from "bun:test";
import { isRtlText } from "./rtl.ts";

describe("isRtlText", () => {
  test("detects Arabic script as RTL", () => {
    expect(isRtlText("ملاحظة الراكب")).toBe(true);
    expect(isRtlText("حجز رقم bk_8f2a")).toBe(true);
  });

  test("latin / non-strings are not RTL", () => {
    expect(isRtlText("mara@skyport.dev")).toBe(false);
    expect(isRtlText("SK-441")).toBe(false);
    expect(isRtlText(42)).toBe(false);
    expect(isRtlText(null)).toBe(false);
    expect(isRtlText({ a: 1 })).toBe(false);
  });
});
