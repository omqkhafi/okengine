import { describe, expect, test } from "bun:test";
import {
  rotateConfirmation,
  rotateMasterConfirmation,
  setConfirmation,
  validateTypedConfirm,
} from "./confirmation.ts";

describe("vault confirmation", () => {
  test("set records a reason, not a typed phrase", () => {
    expect(setConfirmation({ production: true })).toEqual({ kind: "reason" });
  });

  test("rotate records a reason, not a typed phrase", () => {
    expect(rotateConfirmation({ production: false })).toEqual({ kind: "reason" });
  });

  test("rotate-master always requires typed confirm", () => {
    expect(rotateMasterConfirmation()).toEqual({
      kind: "typed",
      phrase: "ROTATE_MASTER",
      requireReason: true,
    });
  });

  test("validateTypedConfirm", () => {
    expect(
      validateTypedConfirm({
        typed: "ROTATE",
        reason: "key compromise",
        phrase: "ROTATE",
      }),
    ).toBeNull();
    expect(
      validateTypedConfirm({
        typed: "nope",
        reason: "x",
        phrase: "ROTATE",
      }),
    ).not.toBeNull();
  });
});
