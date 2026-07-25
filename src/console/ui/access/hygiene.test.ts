import { describe, expect, test } from "bun:test";
import { ACCESS_LIST_FIXTURE } from "./fixture.ts";
import { hygieneLines } from "./hygiene.ts";

describe("hygieneLines", () => {
  test("keys unused 90d+, never signed in, expired invites", () => {
    const lines = hygieneLines(ACCESS_LIST_FIXTURE.hygiene);
    expect(lines.some((l) => l.code === "unused-keys")).toBe(true);
    expect(lines.some((l) => l.code === "never-signed-in")).toBe(true);
    expect(lines.some((l) => l.code === "expired-invites")).toBe(true);
  });
});
