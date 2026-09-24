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

  test("choice, score, and duplicate names fail at compile time", async () => {
    const many = Array.from({ length: 255 }, (_, i) => `o${i}: "x"`).join(", ");
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${header}  onUncertain: "abstain",\n  ask: { team: ai.choice("which", { ${many} }) },\n});\n`,
      }),
    ).rejects.toThrow(/max 254/);
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${header}  onUncertain: "abstain",\n  ask: { team: ai.choice("which", { none_of_these: null }) },\n});\n`,
      }),
    ).rejects.toThrow(/none_of_these/);
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${header}  onUncertain: "abstain",\n  ask: { rank: ai.score("rank", ["only"]) },\n});\n`,
      }),
    ).rejects.toThrow(/2–10 levels/);
    await expect(
      extractFromSources({
        "src/flows/a.ts": `${header}  onUncertain: "abstain",\n  ask: { team: ai.choice("which", { a: "A", b: "B" }) },\n});\n`,
        "src/flows/b.ts": `${header}  onUncertain: "abstain",\n  ask: { team: ai.choice("which", { a: "A", b: "B" }) },\n});\n`,
      }),
    ).rejects.toThrow(/duplicate decision name/);
  });

  test("review records the gate name", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const ops = gate.policy("ops", () => true);
        const triage = ai.decision("triage", {
          review: ops,
          ask: { team: ai.choice("which", { a: "A", b: "B" }) },
        });
        on(signal.once("job"), flow("run", {
          durable: true,
          do: async (input, fx) => fx.decide(triage, input),
        }));
      `,
    });
    expect(manifest.ai?.decisions?.triage?.review).toBe("ops");
  });

  test("review resolves a variable to the gate's declared name", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const someVar = gate.policy("ops", () => true);
        const triage = ai.decision("triage", {
          review: someVar,
          ask: { team: ai.choice("which", { a: "A", b: "B" }) },
        });
        on(signal.once("job"), flow("run", {
          durable: true,
          do: async (input, fx) => fx.decide(triage, input),
        }));
      `,
    });
    expect(manifest.ai?.decisions?.triage?.review).toBe("ops");
  });

  test("autonomy and evals survive extraction", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const triage = ai.decision("triage", {
          onUncertain: "abstain",
          evals: "evals/triage.jsonl",
          autonomy: { maxError: 0.05, audit: 0.1, risk: 0.1 },
          ask: { team: ai.choice("which", { a: "A", b: "B" }) },
        });
      `,
    });
    expect(manifest.ai?.decisions?.triage?.evals).toBe("evals/triage.jsonl");
    expect(manifest.ai?.decisions?.triage?.autonomy).toEqual({
      maxError: 0.05,
      audit: 0.1,
      risk: 0.1,
    });
  });

  test("choice options passed through a variable fail to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const options = { a: "A", b: "B" };
          ai.decision("triage", {
            onUncertain: "abstain",
            ask: { team: ai.choice("which", options) },
          });
        `,
      }),
    ).rejects.toThrow(/object literal/);
  });

  test("score levels and a whole question resolve a same-file const", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const levels = ["low", "high"];
        const team = ai.choice("which", { a: "A", b: "B" });
        ai.decision("triage", {
          onUncertain: "abstain",
          ask: { team, rank: ai.score("rank", levels) },
        });
      `,
    });
    expect(manifest.ai?.decisions?.triage?.questions).toEqual(["team", "rank"]);
  });

  test("an unresolved score or question fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          ai.decision("triage", {
            onUncertain: "abstain",
            ask: { rank: ai.score("rank", missing) },
          });
        `,
      }),
    ).rejects.toThrow(/same-file const/);
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          ai.decision("triage", {
            onUncertain: "abstain",
            ask: { team: missingQuestion },
          });
        `,
      }),
    ).rejects.toThrow(/not a same-file const/);
  });
});
