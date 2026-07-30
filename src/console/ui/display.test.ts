import { describe, expect, test } from "bun:test";
import { displayLabel } from "./display.ts";

describe("displayLabel", () => {
  test("falls back to the raw key when description is absent", () => {
    expect(displayLabel("DATABASE_URL")).toBe("DATABASE_URL");
    expect(displayLabel("DATABASE_URL", undefined)).toBe("DATABASE_URL");
    expect(displayLabel("DATABASE_URL", "")).toBe("DATABASE_URL");
  });

  test("prefers a non-empty description", () => {
    expect(displayLabel("DATABASE_URL", "Primary database URL")).toBe("Primary database URL");
  });
});
