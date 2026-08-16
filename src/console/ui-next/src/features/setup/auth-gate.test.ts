import { describe, expect, test } from "bun:test";
import { authGateSurface } from "./auth-gate.ts";

describe("authGateSurface", () => {
  test("keeps First admin while setup is open", () => {
    expect(authGateSurface({ setupClosed: false, claimSucceeded: false })).toBe("claim");
  });

  test("shows Sign in only after setup closed without a claim on this tab", () => {
    expect(authGateSurface({ setupClosed: true, claimSucceeded: false })).toBe("login");
  });

  test("does not flip to Sign in after a successful first-admin claim", () => {
    expect(authGateSurface({ setupClosed: true, claimSucceeded: true })).toBe("claim");
    expect(authGateSurface({ setupClosed: false, claimSucceeded: true })).toBe("claim");
  });
});
