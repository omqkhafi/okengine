import { describe, expect, test } from "bun:test";
import {
  deleteConfirmation,
  editConfirmation,
  purgeConfirmation,
  validateTypedConfirm,
} from "./confirmation.ts";

describe("store confirmation", () => {
  test("edit/delete/purge are typed in production", () => {
    expect(editConfirmation({ production: true })).toEqual({
      kind: "typed",
      phrase: "EDIT",
      requireReason: true,
    });
    expect(deleteConfirmation({ production: true }).kind).toBe("typed");
    expect(purgeConfirmation({ production: true })).toMatchObject({
      phrase: "PURGE",
    });
  });

  test("non-production uses undo window", () => {
    expect(editConfirmation({ production: false }).kind).toBe("undo");
  });

  test("validateTypedConfirm requires phrase + reason", () => {
    expect(
      validateTypedConfirm({
        typed: "EDIT",
        reason: "fix bad row",
        phrase: "EDIT",
      }),
    ).toBeNull();
    expect(
      validateTypedConfirm({ typed: "x", reason: "ab", phrase: "EDIT" }),
    ).not.toBeNull();
  });
});
