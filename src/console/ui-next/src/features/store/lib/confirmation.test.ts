import { describe, expect, test } from "bun:test";
import {
  deleteConfirmation,
  editConfirmation,
  UNDO_WINDOW_MS,
  validateTypedConfirm,
} from "./confirmation.ts";

describe("store confirmation", () => {
  test("production requires typed EDIT/DELETE with reason", () => {
    expect(editConfirmation({ production: true })).toEqual({
      kind: "typed",
      phrase: "EDIT",
      requireReason: true,
    });
    expect(deleteConfirmation({ production: true })).toEqual({
      kind: "typed",
      phrase: "DELETE",
      requireReason: true,
    });
  });

  test("non-production uses undo window", () => {
    expect(editConfirmation({ production: false })).toEqual({
      kind: "undo",
      windowMs: UNDO_WINDOW_MS,
    });
    expect(deleteConfirmation({ production: false })).toEqual({
      kind: "undo",
      windowMs: UNDO_WINDOW_MS,
    });
  });

  test("validateTypedConfirm enforces exact phrase and reason", () => {
    expect(validateTypedConfirm({ typed: "delete", reason: "cleanup", phrase: "DELETE" })).toEqual({
      typed: "Type DELETE to confirm",
    });
    expect(validateTypedConfirm({ typed: "DELETE", reason: "x", phrase: "DELETE" })).toEqual({
      reason: "Reason is required (min 3 characters)",
    });
    expect(
      validateTypedConfirm({ typed: "DELETE", reason: "cleanup", phrase: "DELETE" }),
    ).toBeNull();
    expect(
      validateTypedConfirm({ typed: " DELETE ", reason: "cleanup", phrase: "DELETE" }),
    ).toBeNull();
  });
});
