import { describe, expect, test } from "bun:test";
import {
  rotateConfirmation,
  rotateMasterConfirmation,
  setConfirmation,
  validateTypedConfirm,
} from "./confirmation.ts";

describe("vault confirmation", () => {
  test("set requires typed confirm in production", () => {
    expect(setConfirmation({ production: true })).toEqual({
      kind: "typed",
      phrase: "SET",
      requireReason: true,
    });
  });

  test("rotate always requires typed confirm", () => {
    expect(rotateConfirmation({ production: false })).toEqual({
      kind: "typed",
      phrase: "ROTATE",
      requireReason: true,
    });
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
