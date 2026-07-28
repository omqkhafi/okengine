import { describe, expect, test } from "bun:test";
import { revokeConfirmation, rotateConfirmation, validateTypedConfirm } from "./confirmation.ts";

describe("access confirmation", () => {
  test("revoke and rotate always require typed confirm (D)", () => {
    expect(revokeConfirmation({ production: false })).toEqual({
      kind: "typed",
      phrase: "REVOKE",
      requireReason: true,
    });
    expect(rotateConfirmation({ production: false })).toEqual({
      kind: "typed",
      phrase: "ROTATE",
      requireReason: true,
    });
  });

  test("validateTypedConfirm", () => {
    expect(
      validateTypedConfirm({
        typed: "REVOKE",
        reason: "compromised",
        phrase: "REVOKE",
      }),
    ).toBeNull();
    expect(
      validateTypedConfirm({
        typed: "done",
        reason: "x",
        phrase: "REVOKE",
      }),
    ).not.toBeNull();
  });
});
