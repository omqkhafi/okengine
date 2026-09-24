/**
 * Decisions page resolve checks.
 */

import { describe, expect, test } from "bun:test";
import { decisionStateLabel, decisionValuesValid, resolveDecisionWithRetry } from "./resolve.ts";

describe("decision resolve form", () => {
  test("choice and score values must be one of the declared options or levels", () => {
    const questions = [
      { id: "team", kind: "choice" as const, options: ["billing", "none_of_these"] },
      { id: "rank", kind: "score" as const, levels: ["low", "high"] },
    ];
    expect(decisionValuesValid(questions, { team: "billing", rank: "low" })).toBe(true);
    expect(decisionValuesValid(questions, { team: "other", rank: "low" })).toBe(false);
    expect(decisionValuesValid(questions, { team: "billing", rank: "mid" })).toBe(false);
  });

  test("candidate ready is the label for a fitted candidate", () => {
    expect(decisionStateLabel("candidate")).toBe("candidate ready");
    expect(decisionStateLabel("suspended")).toBe("suspended");
  });

  test("a lease collision retries and a conflict does not", async () => {
    let calls = 0;
    const leased = await resolveDecisionWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) return { error: { code: "JournalLeaseBusy" } };
        return { data: { ok: true as const } };
      },
      { id: "1", values: { team: "billing" } },
    );
    expect(leased.data?.ok).toBe(true);
    expect(calls).toBe(3);

    let conflictCalls = 0;
    const conflict = await resolveDecisionWithRetry(
      async () => {
        conflictCalls += 1;
        return { error: { code: "Conflict" } };
      },
      { id: "1", values: { team: "billing" } },
    );
    expect(conflict.error?.code).toBe("Conflict");
    expect(conflictCalls).toBe(1);
  });
});
