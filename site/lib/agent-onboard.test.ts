/**
 * Gate: homepage AI onboard prompt points at real shipped surfaces only.
 */

import { describe, expect, test } from "bun:test";
import { agentOnboardPrompt, agentsMdUrl, DOCS_ORIGIN, llmsTxtUrl } from "./agent-onboard";

describe("agent onboard prompt", () => {
  test("uses canonical llms.txt and raw AGENTS.md URLs", () => {
    expect(llmsTxtUrl()).toBe(`${DOCS_ORIGIN}/llms.txt`);
    expect(agentsMdUrl()).toBe(
      "https://raw.githubusercontent.com/omqkhafi/okengine/main/AGENTS.md",
    );
    expect(agentOnboardPrompt()).toBe(
      `Read ${DOCS_ORIGIN}/llms.txt and https://raw.githubusercontent.com/omqkhafi/okengine/main/AGENTS.md…`,
    );
  });

  test("honors a custom origin for llms.txt (local / preview)", () => {
    expect(agentOnboardPrompt("http://localhost:3000")).toBe(
      "Read http://localhost:3000/llms.txt and https://raw.githubusercontent.com/omqkhafi/okengine/main/AGENTS.md…",
    );
  });
});
