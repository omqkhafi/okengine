/**
 * Critical-path tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import { criticalPathSpanIds } from "./critical-path.ts";
import { TRACES_FIXTURE } from "./fixture.ts";

describe("criticalPathSpanIds", () => {
  test("selects the longer root-to-leaf work path", () => {
    const chain = TRACES_FIXTURE.filter(
      (s) => s.id === "run-create-ok" || s.id === "run-fulfill",
    );
    const path = criticalPathSpanIds(chain);
    expect(path.has("run-create-ok")).toBe(true);
    expect(path.has("run-fulfill")).toBe(true);
  });

  test("single-span trace is its own critical path", () => {
    const ask = TRACES_FIXTURE.filter((s) => s.id === "run-ask");
    const path = criticalPathSpanIds(ask);
    expect([...path]).toEqual(["run-ask"]);
  });
});
