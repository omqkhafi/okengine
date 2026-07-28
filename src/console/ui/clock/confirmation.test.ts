/**
 * Run-now confirmation — external follows D.
 */

import { describe, expect, test } from "bun:test";
import { runNowConfirmation } from "./confirmation.ts";
import { CLOCK_LIST_FIXTURE } from "./fixture.ts";

describe("runNowConfirmation", () => {
  test("typed RUN when external in production", () => {
    const nightly = CLOCK_LIST_FIXTURE.crons.find((c) => c.name === "nightly")!;
    expect(runNowConfirmation(nightly, { production: true })).toEqual({
      kind: "typed",
      phrase: "RUN",
      requireReason: true,
    });
  });

  test("undo when not external", () => {
    const expire = CLOCK_LIST_FIXTURE.crons.find((c) => c.name === "expire-holds")!;
    const conf = runNowConfirmation(expire, { production: true });
    expect(conf.kind).toBe("undo");
  });

  test("undo when external but not production", () => {
    const nightly = CLOCK_LIST_FIXTURE.crons.find((c) => c.name === "nightly")!;
    const conf = runNowConfirmation(nightly, { production: false });
    expect(conf.kind).toBe("undo");
  });
});
