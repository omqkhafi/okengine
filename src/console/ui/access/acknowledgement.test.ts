import { describe, expect, test } from "bun:test";
import { canDismissOnceSecret, ONCE_SECRET_ACK_LABEL } from "./acknowledgement.ts";

describe("once-secret acknowledgement", () => {
  test("dismiss requires explicit acknowledgement — not a soft done", () => {
    expect(canDismissOnceSecret({ acknowledged: false })).toBe(false);
    expect(canDismissOnceSecret({ acknowledged: true })).toBe(true);
    expect(ONCE_SECRET_ACK_LABEL.toLowerCase()).toContain("not be shown again");
  });
});
