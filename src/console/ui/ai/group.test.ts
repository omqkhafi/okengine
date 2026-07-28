/**
 * AI catalogue filter / group tests (console §9.10).
 */

import { describe, expect, test } from "bun:test";
import { AI_LIST_FIXTURE } from "./fixture.ts";
import {
  allowPiiStanding,
  filterAgents,
  filterPrompts,
  runsForAgent,
  versionsForPrompt,
} from "./group.ts";

describe("AI group helpers", () => {
  test("filterPrompts matches name", () => {
    expect(filterPrompts(AI_LIST_FIXTURE.prompts, "triage")).toHaveLength(1);
    expect(filterPrompts(AI_LIST_FIXTURE.prompts, "nope")).toHaveLength(0);
  });

  test("versionsForPrompt sorts ascending", () => {
    const vs = versionsForPrompt(AI_LIST_FIXTURE.versions, "ticket-triage");
    expect(vs.map((v) => v.version)).toEqual([2, 3]);
  });

  test("allowPiiStanding keeps only acknowledgements", () => {
    expect(allowPiiStanding(AI_LIST_FIXTURE.allowPii)).toHaveLength(1);
    expect(allowPiiStanding(AI_LIST_FIXTURE.allowPii)[0]!.flowId).toBe("support.createTicket");
  });

  test("runsForAgent + filterAgents", () => {
    expect(filterAgents(AI_LIST_FIXTURE.agents, "support")).toHaveLength(1);
    expect(runsForAgent(AI_LIST_FIXTURE.agentRuns, "support")).toHaveLength(1);
  });
});
