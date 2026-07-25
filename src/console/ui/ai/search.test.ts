/**
 * AI URL search tests (console §9.10).
 */

import { describe, expect, test } from "bun:test";
import {
  manifestDiffHref,
  openPromptVersion,
  parseAiSearch,
  serializeAiSearch,
} from "./search.ts";

describe("AI search", () => {
  test("round-trips prompt + version", () => {
    const parsed = parseAiSearch({ prompt: "ticket-triage", version: "3" });
    expect(parsed.prompt).toBe("ticket-triage");
    expect(parsed.version).toBe(3);
    expect(serializeAiSearch(parsed)).toEqual({
      prompt: "ticket-triage",
      version: 3,
    });
  });

  test("manifestDiffHref links to Manifest Diff, does not embed blast radius", () => {
    expect(manifestDiffHref("/ai/prompts/ticket-triage/version")).toBe(
      "/manifest-diff?path=%2Fai%2Fprompts%2Fticket-triage%2Fversion",
    );
  });

  test("openPromptVersion clears agent selection", () => {
    const next = openPromptVersion(
      { agent: "support", run: "r1" },
      "ticket-triage",
      3,
    );
    expect(next.agent).toBeUndefined();
    expect(next.prompt).toBe("ticket-triage");
    expect(next.version).toBe(3);
  });
});
