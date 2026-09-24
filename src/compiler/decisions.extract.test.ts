/**
 * Decision extraction: exclusive modes, and review cannot sit on HTTP.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

const header = `const triage = ai.decision("triage", {\n`;

describe("ai.decision extract", () => {
  test("review and abstain together fail to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${header}  review: "ops",\n  onUncertain: "abstain",\n  ask: { team: ai.choice("which", { a: "A" }) },\n});\n`,
      }),
    ).rejects.toThrow(/exactly one of review/);
  });

  test("an HTTP trigger that reviews fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const triage = ai.decision("triage", {
            review: "ops",
            ask: { team: ai.choice("which", { a: "A" }) },
          });
          on(http.post("/t"), flow("run", {
            durable: true,
            do: async (input, fx) => fx.decide(triage, input),
          }));
        `,
      }),
    ).rejects.toThrow(/fx\.emit/);
  });
});
