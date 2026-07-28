/**
 * Typed denial formatting — RateLimited { retryAfterMs } (console §9.7).
 */

import { describe, expect, test } from "bun:test";
import { formatDenial, formatEvaluationStep } from "./denial.ts";
import { SIMULATE_RATE_FIXTURE } from "./fixture.ts";

describe("formatDenial", () => {
  test("RateLimited carries retryAfterMs and 429", () => {
    expect(formatDenial(SIMULATE_RATE_FIXTURE.denial!)).toBe(
      "RateLimited { retryAfterMs: 12000 } · HTTP 429",
    );
  });

  test("Forbidden carries gate + reason", () => {
    expect(
      formatDenial({
        code: "Forbidden",
        data: { gate: "member", reason: "policy denied" },
        status: 403,
      }),
    ).toContain("Forbidden { gate: member");
  });
});

describe("formatEvaluationStep", () => {
  test("preserves registration order marks", () => {
    const steps = SIMULATE_RATE_FIXTURE.evaluations.map((e, i) => formatEvaluationStep(e, i));
    expect(steps[0]).toContain("pass");
    expect(steps[2]).toContain("deny");
    expect(steps[2]).toContain("retryAfterMs 12000");
  });
});
