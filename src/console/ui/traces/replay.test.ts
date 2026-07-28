/**
 * Replay reversibility tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import { TRACES_FIXTURE } from "./fixture.ts";
import { replayDecision } from "./replay.ts";

describe("replayDecision", () => {
  test("offers dry-run when the trace has an external effect", () => {
    const chain = TRACES_FIXTURE.filter((s) => s.id === "run-create-ok" || s.id === "run-fulfill");
    const decision = replayDecision(chain);
    expect(decision.mode).toBe("dry-run");
    if (decision.mode !== "dry-run") return;
    expect(decision.reason).toContain("external");
  });

  test("allows full replay when every effect is reversible", () => {
    const fail = TRACES_FIXTURE.filter((s) => s.id === "run-create-fail");
    expect(replayDecision(fail)).toEqual({ mode: "replay" });
  });
});
