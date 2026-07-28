/**
 * New-rows buffer — never move the ground (console §7.2).
 */

import { describe, expect, test } from "bun:test";
import { createRowBuffer, matchesQuery } from "./buffer.ts";
import { confirmationFor, createUndoStack, validateTypedConfirm } from "./confirmation.ts";

describe("row buffer", () => {
  test("new rows buffer behind a pill and never push existing ones", () => {
    const buf = createRowBuffer([
      { id: "a", value: 1, arrivedAt: 1 },
      { id: "b", value: 2, arrivedAt: 2 },
    ]);
    buf.offer({ id: "c", value: 3, arrivedAt: 3 });
    expect(buf.visible.map((r) => r.id)).toEqual(["a", "b"]);
    expect(buf.pendingCount).toBe(1);

    buf.flush();
    expect(buf.visible.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(buf.pendingCount).toBe(0);
  });

  test("updates existing rows in place", () => {
    const buf = createRowBuffer([{ id: "a", value: 1, arrivedAt: 1 }]);
    buf.offer({ id: "a", value: 9, arrivedAt: 2 });
    expect(buf.visible[0]?.value).toBe(9);
    expect(buf.pendingCount).toBe(0);
  });
});

describe("dim never hide", () => {
  test("matchesQuery is case-insensitive", () => {
    expect(matchesQuery(["Bookings.Create"], "book")).toBe(true);
    expect(matchesQuery(["payments"], "book")).toBe(false);
  });
});

describe("confirmation pattern", () => {
  test("reversible actions get undo; irreversible get typed confirm", () => {
    expect(confirmationFor("writes").kind).toBe("undo");
    expect(confirmationFor("external", { production: true }).kind).toBe("typed");
    expect(confirmationFor("external", { production: false }).kind).toBe("undo");
  });

  test("typed confirm requires phrase and reason", () => {
    expect(
      validateTypedConfirm({
        typed: "INVOKE",
        reason: "incident replay",
        phrase: "INVOKE",
      }),
    ).toBeNull();
    expect(
      validateTypedConfirm({
        typed: "yes",
        reason: "x",
        phrase: "INVOKE",
      }),
    ).toEqual({
      typed: "Type INVOKE to confirm",
      reason: "Reason is required (min 3 characters)",
    });
  });

  test("undo stack expires", async () => {
    let t = 0;
    const stack = createUndoStack(() => t);
    let undone = false;
    stack.push({
      id: "1",
      label: "ping",
      payload: null,
      windowMs: 15_000,
      undo: () => {
        undone = true;
      },
    });
    t = 16_000;
    expect(await stack.undo("1")).toBe(false);
    expect(undone).toBe(false);
  });
});
