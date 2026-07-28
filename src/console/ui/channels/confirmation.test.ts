/**
 * Send-test confirmation — typed SEND in production.
 */

import { describe, expect, test } from "bun:test";
import { sendTestConfirmation, validateTypedConfirm } from "./confirmation.ts";

describe("sendTestConfirmation", () => {
  test("production requires typed SEND + reason", () => {
    expect(sendTestConfirmation({ production: true })).toEqual({
      kind: "typed",
      phrase: "SEND",
      requireReason: true,
    });
    expect(
      validateTypedConfirm({
        typed: "SEND",
        reason: "verify otp",
        phrase: "SEND",
      }),
    ).toBeNull();
    expect(
      validateTypedConfirm({
        typed: "send",
        reason: "x",
        phrase: "SEND",
      }),
    ).not.toBeNull();
  });

  test("non-production uses undo window", () => {
    expect(sendTestConfirmation({ production: false }).kind).toBe("undo");
  });
});
