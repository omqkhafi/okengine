/**
 * Agent tool approval is a Manifest flag. The predicate stays in author code.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

describe("extract agent approval", () => {
  test("approval: true is recorded and a plain tool is not", async () => {
    const manifest = await extractFromSources({
      "src/flows/assist.ts": `
        import { ai } from "okengine";
        export const support = ai.agent("support", {
          tools: [{ name: "billing.refund", approval: true, gate: "ops" }, "billing.lookup"],
        });
      `,
    });
    expect(manifest.ai?.agents?.support?.tools).toEqual(["billing.refund", "billing.lookup"]);
    expect(manifest.ai?.agents?.support?.approvals).toEqual({ "billing.refund": true });
  });

  test("fx.run asks the agent and an agent tool is a call", async () => {
    const manifest = await extractFromSources({
      "src/flows/assist.ts": `
        import { ai, flow, on, http } from "okengine";
        const lookup = ai.agent("lookup", { tools: [] });
        const support = ai.agent("support", { tools: [lookup] });
        export const assist = on(http.post("/assist"), flow("assist", {
          do: async (_input, fx) => fx.run(support, { message: "hi" }),
        }));
      `,
    });
    expect(manifest.flows?.assist?.effects?.asks).toContain("support");
    expect(manifest.flows?.assist?.effects?.calls).toContain("lookup");
  });
});
