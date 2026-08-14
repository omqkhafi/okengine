import { describe, expect, test } from "bun:test";
import { shouldExpireSession } from "./client.ts";

describe("shouldExpireSession", () => {
  test("expires a mid-shell Unauthorized", () => {
    expect(shouldExpireSession("/console/store", { code: "Unauthorized" })).toBe(true);
    expect(shouldExpireSession("/console/runs", { code: "Unauthorized" })).toBe(true);
  });

  test("leaves claim, login, and session/me to the route guard", () => {
    expect(shouldExpireSession("/console/session/me", { code: "Unauthorized" })).toBe(false);
    expect(shouldExpireSession("/console/session/login", { code: "Unauthorized" })).toBe(false);
    expect(shouldExpireSession("/console/setup/status", { code: "Unauthorized" })).toBe(false);
    expect(shouldExpireSession("/console/setup/claim", { code: "Unauthorized" })).toBe(false);
  });

  test("ignores non-auth failures", () => {
    expect(shouldExpireSession("/console/store", { code: "Forbidden" })).toBe(false);
    expect(shouldExpireSession("/console/store", null)).toBe(false);
  });
});
