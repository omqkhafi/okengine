/**
 * Seven-state taxonomy + consequence ranking (console §9.9).
 */

import { describe, expect, test } from "bun:test";
import {
  buildOutcomeRows,
  formatAttemptChain,
  VERDICT_BY_STATE,
} from "./outcomes.ts";

describe("delivery outcome taxonomy", () => {
  test("every state carries a verdict", () => {
    expect(VERDICT_BY_STATE["suppressed/opted-out"]).toBe("correct");
    expect(VERDICT_BY_STATE["hard-bounce"]).toBe("suppress");
    expect(VERDICT_BY_STATE["delivered-then-complained"]).toBe("review");
    expect(VERDICT_BY_STATE["soft-bounce"]).toBe("retry");
  });

  test("complaints outrank many hard bounces by consequence weight", () => {
    const ranked = buildOutcomeRows({
      "hard-bounce": 14,
      "delivered-then-complained": 4,
      "soft-bounce": 20,
    });
    expect(ranked[0]!.state).toBe("delivered-then-complained");
    expect(ranked[0]!.verdict).toBe("review");
    expect(ranked[0]!.count).toBe(4);
    expect(ranked.find((r) => r.state === "hard-bounce")!.count).toBe(14);
  });

  test("formatAttemptChain records both attempts", () => {
    expect(
      formatAttemptChain([
        { driverId: "whatsapp", ok: false },
        { driverId: "sms", ok: true },
      ]),
    ).toBe("whatsapp failed → sms succeeded");
  });
});
