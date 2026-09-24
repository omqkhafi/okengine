import { describe, expect, test } from "bun:test";
import { effectAiHref } from "./effect-summary.ts";

describe("effectAiHref", () => {
  const agents = new Set(["planner"]);

  test("an agent run id opens that run", () => {
    expect(effectAiHref({ kind: "ask", resource: "planner", agentRunId: "run-9" }, agents)).toBe(
      "/observability?view=ai&agentRun=run-9",
    );
    expect(effectAiHref({ kind: "call", resource: "planner", agentRunId: "run-9" }, agents)).toBe(
      "/observability?view=ai&agentRun=run-9",
    );
  });

  test("without a run id the link searches by name", () => {
    expect(effectAiHref({ kind: "ask", resource: "weekly-summary@1" }, agents)).toBe(
      "/observability?view=ai&q=weekly-summary",
    );
    expect(effectAiHref({ kind: "call", resource: "planner" }, agents)).toBe(
      "/observability?view=ai&q=planner",
    );
  });
});
