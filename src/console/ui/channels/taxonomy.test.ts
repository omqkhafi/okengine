/**
 * Taxonomy weighting — complaints outrank many hard bounces.
 */

import { describe, expect, test } from "bun:test";
import { CHANNELS_LIST_FIXTURE } from "./fixture.ts";
import { isConsequenceEmphasized, sortByConsequence } from "./taxonomy.ts";

describe("channels taxonomy", () => {
  test("complaints rank above hard bounces despite lower count", () => {
    const ranked = sortByConsequence(CHANNELS_LIST_FIXTURE.outcomes);
    expect(ranked[0]!.state).toBe("delivered-then-complained");
    expect(ranked[0]!.count).toBe(4);
    expect(ranked.find((r) => r.state === "hard-bounce")!.count).toBe(14);
    expect(isConsequenceEmphasized(ranked[0]!)).toBe(true);
  });
});
