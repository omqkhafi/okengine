import { describe, expect, test } from "bun:test";

import { isoAt } from "./iso-at.ts";

describe("isoAt", () => {
  test("formats epoch ms as UTC ISO-8601", () => {
    expect(isoAt(1_787_305_011_525)).toBe("2026-08-21T09:36:51.525Z");
  });
});
