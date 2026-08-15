import { describe, expect, test } from "bun:test";
import {
  createConfirmation,
  rotateConfirmation,
  rotateMasterConfirmation,
  setConfirmation,
  validateTypedConfirm,
} from "./confirmation.ts";

describe("vault confirmation", () => {
  test("create / set / rotate use a review dialog, not a typed phrase", () => {
    expect(createConfirmation()).toEqual({ kind: "review" });
    expect(setConfirmation({ production: true })).toEqual({ kind: "review" });
    expect(rotateConfirmation({ production: false })).toEqual({ kind: "review" });
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
