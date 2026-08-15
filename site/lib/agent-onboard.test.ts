/**
 * Gate: homepage AI onboard prompt points at real shipped surfaces only.
 */

import { describe, expect, test } from "bun:test";
import { agentOnboardPrompt, agentsMdUrl, DOCS_ORIGIN, llmsTxtUrl } from "./agent-onboard";

describe("agent onboard prompt", () => {
  test("uses canonical llms.txt and site-hosted agent contract URLs", () => {
    expect(llmsTxtUrl()).toBe(`${DOCS_ORIGIN}/llms.txt`);
    expect(agentsMdUrl()).toBe(`${DOCS_ORIGIN}/llms/agents`);
    expect(agentOnboardPrompt()).toBe(`Read ${DOCS_ORIGIN}/llms.txt and ${DOCS_ORIGIN}/llms/agents…`);
  });

  test("honors a custom origin for llms.txt and the contract (local / preview)", () => {
    expect(agentOnboardPrompt("http://localhost:3000")).toBe(
      "Read http://localhost:3000/llms.txt and http://localhost:3000/llms/agents…",
    );
  });
});
