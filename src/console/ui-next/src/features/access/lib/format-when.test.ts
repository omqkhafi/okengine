import { describe, expect, test } from "bun:test";
import {
  accessExpiresAt,
  accessExpiryFromAt,
  accessRefreshExpiry,
  formatAccessDuration,
  formatAccessExpiry,
  formatAccessRateLimit,
  formatAccessWhen,
  classifyAccessAllowEntry,
  parseAccessAllowlist,
  parseAccessDurationMs,
  parseAccessRateLimit,
  parseAccessRateParts,
  splitAccessRatePer,
} from "./format-when.ts";

const NOW = Date.parse("2026-08-21T17:42:00.000Z");

describe("formatAccessWhen", () => {
  test("null is never", () => {
    expect(formatAccessWhen(null, NOW)).toBe("never");
  });

  test("sub-minute is just now", () => {
    expect(formatAccessWhen(NOW - 12_000, NOW)).toBe("just now");
    expect(formatAccessWhen(NOW + 12_000, NOW)).toBe("just now");
  });

  test("past ages", () => {
    expect(formatAccessWhen(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatAccessWhen(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatAccessWhen(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
  });

  test("future remaining", () => {
    expect(formatAccessWhen(NOW + 30 * 86_400_000, NOW)).toBe("in 30d");
    expect(formatAccessWhen(NOW + 90 * 86_400_000, NOW)).toBe("in 90d");
  });
});

describe("formatAccessExpiry", () => {
  test("null is never", () => {
    expect(formatAccessExpiry(null, NOW)).toBe("never");
  });

  test("past is expired, not an age", () => {
    expect(formatAccessExpiry(NOW - 5 * 60_000, NOW)).toBe("expired");
  });

  test("future is remaining", () => {
    expect(formatAccessExpiry(NOW + 89 * 86_400_000, NOW)).toBe("in 89d");
  });
});

describe("accessExpiresAt", () => {
  test("presets", () => {
    expect(accessExpiresAt("never", NOW)).toBeNull();
    expect(accessExpiresAt("30d", NOW)).toBe(NOW + 30 * 86_400_000);
    expect(accessExpiresAt("90d", NOW)).toBe(NOW + 90 * 86_400_000);
  });

  test("custom duration", () => {
    expect(accessExpiresAt("custom", NOW, "7d")).toBe(NOW + 7 * 86_400_000);
    expect(accessExpiresAt("custom", NOW, "12h")).toBe(NOW + 12 * 3_600_000);
    expect(accessExpiresAt("custom", NOW, "nope")).toBeNull();
  });
});

describe("parseAccessDurationMs", () => {
  test("clock grammar", () => {
    expect(parseAccessDurationMs("7d")).toBe(7 * 86_400_000);
    expect(parseAccessDurationMs("30m")).toBe(30 * 60_000);
    expect(parseAccessDurationMs("")).toBe(0);
    expect(parseAccessDurationMs("90")).toBe(0);
  });
});

describe("accessExpiryFromAt", () => {
  test("reconstructs presets and custom remainder", () => {
    expect(accessExpiryFromAt(null, NOW)).toEqual({ choice: "never", custom: "" });
    expect(accessExpiryFromAt(NOW + 30 * 86_400_000, NOW)).toEqual({ choice: "30d", custom: "" });
    expect(accessExpiryFromAt(NOW + 7 * 86_400_000, NOW)).toEqual({
      choice: "custom",
      custom: "7d",
    });
  });
});

describe("accessRefreshExpiry", () => {
  test("never and expired default to 90d", () => {
    expect(accessRefreshExpiry(null, NOW)).toEqual({ choice: "90d", custom: "" });
    expect(accessRefreshExpiry(NOW - 1, NOW)).toEqual({ choice: "90d", custom: "" });
  });

  test("snaps remaining life so 89d renews as 90d", () => {
    expect(accessRefreshExpiry(NOW + 89 * 86_400_000, NOW)).toEqual({
      choice: "90d",
      custom: "",
    });
    expect(accessRefreshExpiry(NOW + 23 * 86_400_000, NOW)).toEqual({
      choice: "30d",
      custom: "",
    });
  });

  test("keeps custom windows that are not near a preset", () => {
    expect(accessRefreshExpiry(NOW + 7 * 86_400_000, NOW)).toEqual({
      choice: "custom",
      custom: "7d",
    });
  });
});

describe("rate and allowlist", () => {
  test("parse and format", () => {
    expect(parseAccessRateLimit("")).toBeNull();
    expect(parseAccessRateLimit("60 / 1m")).toEqual({ max: 60, per: "1m" });
    expect(parseAccessRateLimit("nope")).toBeUndefined();
    expect(formatAccessRateLimit({ max: 60, per: "1m" })).toBe("60 / 1m");
    expect(parseAccessAllowlist("203.0.113.4, 198.51.100.7")).toEqual([
      "203.0.113.4",
      "198.51.100.7",
    ]);
    expect(parseAccessAllowlist("https://ci.example.com/")).toEqual(["ci.example.com"]);
    expect(parseAccessAllowlist("google.com, sdfghjfdsd, not a host")).toEqual(["google.com"]);
    expect(parseAccessAllowlist("localhost")).toEqual(["localhost"]);
    expect(parseAccessAllowlist("[::1]")).toEqual(["::1"]);
    expect(classifyAccessAllowEntry("203.0.113.4")).toBe("ip");
    expect(classifyAccessAllowEntry("ci.example.com")).toBe("host");
    expect(classifyAccessAllowEntry("sdfghjfdsd")).toBeNull();
    expect(formatAccessDuration(12 * 3_600_000)).toBe("12h");
    expect(parseAccessRateParts("", "", "m")).toBeNull();
    expect(parseAccessRateParts("90", "", "m")).toBeUndefined();
    expect(parseAccessRateParts("90", "1", "m")).toEqual({ max: 90, per: "1m" });
    expect(splitAccessRatePer("90s")).toEqual({ count: "90", unit: "s" });
    expect(splitAccessRatePer("")).toEqual({ count: "", unit: "m" });
  });
});
