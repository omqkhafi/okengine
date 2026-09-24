/**
 * Prompt `repair` is copied onto the Manifest the same way as `budget`.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

describe("extract prompt repair", () => {
  test("repair: 1 is recorded and repair: 0 is omitted", async () => {
    const manifest = await extractFromSources({
      "src/flows/triage.ts": `
        import { ai } from "okengine";
        export const smart = ai.model("smart", { provider: "mock" });
        smart.prompt("ticket-triage", { repair: 1, budget: { maxCostPerCall: 0.02 } });
        smart.prompt("plain", { repair: 0 });
      `,
    });
    expect(manifest.ai?.prompts?.["ticket-triage"]?.repair).toBe(1);
    expect(manifest.ai?.prompts?.["ticket-triage"]?.budget?.maxCostPerCall).toBe(0.02);
    expect(manifest.ai?.prompts?.plain?.repair).toBeUndefined();
  });
});
