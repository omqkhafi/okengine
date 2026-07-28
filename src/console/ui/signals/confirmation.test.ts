import { describe, expect, test } from "bun:test";
import { discardConfirmation, replayConfirmation, validateTypedConfirm } from "./confirmation.ts";
import { SIGNALS_FIXTURE } from "./fixture.ts";

describe("signal confirmation", () => {
  test("external non-durable consumer requires typed REPLAY in production", () => {
    const order = SIGNALS_FIXTURE.find((s) => s.name === "order-placed")!;
    const c = replayConfirmation(order, { production: true });
    expect(c.kind).toBe("typed");
    if (c.kind === "typed") expect(c.phrase).toBe("REPLAY");
  });

  test("durable broadcast consumers get undo window", () => {
    const inv = SIGNALS_FIXTURE.find((s) => s.name === "inventory-changed")!;
    const c = replayConfirmation(inv, { production: true });
    expect(c.kind).toBe("undo");
  });

  test("discard requires typed confirmation in production", () => {
    const order = SIGNALS_FIXTURE.find((s) => s.name === "order-placed")!;
    const c = discardConfirmation(order, { production: true });
    expect(c.kind).toBe("typed");
    if (c.kind === "typed") expect(c.phrase).toBe("DISCARD");
  });

  test("validateTypedConfirm rejects short reason", () => {
    expect(
      validateTypedConfirm({
        typed: "REPLAY",
        reason: "no",
        phrase: "REPLAY",
      }),
    ).not.toBeNull();
  });
});
