import { describe, expect, test } from "bun:test";
import { formatByteSize, formatKvTtl, kvValueSizeBytes, parseKvTtlDraft } from "./kv-meta.ts";

describe("formatKvTtl", () => {
  test("formats remaining time and treats missing as em dash", () => {
    expect(formatKvTtl(null)).toBe("—");
    expect(formatKvTtl(undefined)).toBe("—");
    expect(formatKvTtl(0)).toBe("0s");
    expect(formatKvTtl(1_200)).toBe("1s");
    expect(formatKvTtl(45_000)).toBe("45s");
    expect(formatKvTtl(12 * 60_000)).toBe("12m");
    expect(formatKvTtl(2 * 3_600_000)).toBe("2h");
    expect(formatKvTtl(3 * 86_400_000)).toBe("3d");
    expect(formatKvTtl("30m")).toBe("30m");
  });
});

describe("parseKvTtlDraft", () => {
  test("accepts duration strings and clears on empty", () => {
    expect(parseKvTtlDraft("30m")).toBe("30m");
    expect(parseKvTtlDraft(" 1h ")).toBe("1h");
    expect(parseKvTtlDraft("")).toBeNull();
    expect(parseKvTtlDraft("—")).toBeNull();
    expect(parseKvTtlDraft("none")).toBeNull();
    expect(parseKvTtlDraft("2 hours")).toBeUndefined();
  });
});

describe("formatByteSize", () => {
  test("steps through B / KB / MB", () => {
    expect(formatByteSize(128)).toBe("128 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(20_480)).toBe("20 KB");
    expect(formatByteSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("kvValueSizeBytes", () => {
  test("counts UTF-8 JSON bytes", () => {
    expect(kvValueSizeBytes({ a: 1 })).toBe(new TextEncoder().encode('{"a":1}').length);
    expect(kvValueSizeBytes(null)).toBe(4);
  });
});
