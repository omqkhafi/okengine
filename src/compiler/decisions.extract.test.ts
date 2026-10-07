/**
 * Decision extraction: decider, otherwise, and capability limits.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

const decider = `const jev = ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13" });\n`;

describe("ai.decision extract", () => {
  test("a decision without otherwise fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${decider}ai.decision("triage", {\n  decider: jev,\n  ask: { team: ai.choice("which", { a: "A" }) },\n});\n`,
      }),
    ).rejects.toThrow(/otherwise is required/);
  });

  test("shadow fails to compile as planned", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${decider}ai.decision("triage", {\n  decider: jev,\n  otherwise: "abstain",\n  shadow: "other",\n  ask: { team: ai.choice("which", { a: "A" }) },\n});\n`,
      }),
    ).rejects.toThrow(/planned/);
  });

  test("an HTTP trigger that parks fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
          const triage = ai.decision("triage", {
            decider: jev,
            otherwise: "ops",
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

  test("a custom decider's max choices fails at compile time", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const host = ai.decider("host", {
            driverId: "systemone",
            baseUrl: "https://example.test/decisions",
            model: "m",
            secret: "HOST_KEY",
            capabilities: { boolean: true, choice: true, score: true, refusal: false, maxChoices: 1 },
          });
          ai.decision("triage", {
            decider: host,
            otherwise: "abstain",
            ask: { team: ai.choice("which", { a: "A", b: "B" }) },
          });
        `,
      }),
    ).rejects.toThrow(/allows 1/);
  });

  test("author none_of_these fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `${decider}ai.decision("triage", {\n  decider: jev,\n  otherwise: "abstain",\n  ask: { team: ai.choice("which", { none_of_these: null }) },\n});\n`,
      }),
    ).rejects.toThrow(/none_of_these/);
  });

  test("duplicate names fail to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/a.ts": `${decider}ai.decision("triage", {\n  decider: jev,\n  otherwise: "abstain",\n  ask: { team: ai.choice("which", { a: "A", b: "B" }) },\n});\n`,
        "src/flows/b.ts": `${decider}ai.decision("triage", {\n  decider: jev,\n  otherwise: "abstain",\n  ask: { team: ai.choice("which", { a: "A", b: "B" }) },\n});\n`,
      }),
    ).rejects.toThrow(/duplicate/);
  });

  test("otherwise resolves a gate and a durable flow parks", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
        const triage = ai.decision("triage", {
          decider: jev,
          otherwise: "ops",
          ask: { team: ai.choice("which", { a: "A" }) },
        });
        on(signal.once("job"), flow("run", {
          durable: true,
          do: async (input, fx) => fx.decide(triage, input),
        }));
      `,
    });
    expect(manifest.ai?.decisions?.triage?.otherwise).toBe("ops");
    expect(manifest.ai?.decisions?.triage?.review).toBe("ops");
    expect(manifest.flows?.run?.effects?.secrets).toEqual(["OPENROUTER_API_KEY"]);
    expect(manifest.ai?.deciders?.jev?.pinning).toBe("dated");
  });

  test("otherwise resolves a variable to the gate's declared name", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
        const someVar = gate.policy("ops", () => true);
        const triage = ai.decision("triage", {
          decider: jev,
          otherwise: someVar,
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
        const jev = ai.decider("jev", { provider: "openrouter", model: "m", region: "eu" });
        const triage = ai.decision("triage", {
          decider: jev,
          otherwise: "abstain",
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
    expect(manifest.ai?.deciders?.jev?.region).toBe("eu");
    expect(manifest.ai?.deciders?.jev?.regionStatus).toBe("declared");
  });

  test("choice options passed through a variable fail to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
          const options = { a: "A", b: "B" };
          ai.decision("triage", {
            decider: jev,
            otherwise: "abstain",
            ask: { team: ai.choice("which", options) },
          });
        `,
      }),
    ).rejects.toThrow(/object literal/);
  });

  test("score levels and a whole question resolve a same-file const", async () => {
    const manifest = await extractFromSources({
      "src/flows/run.ts": `
        const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
        const levels = ["low", "high"];
        const team = ai.choice("which", { a: "A", b: "B" });
        ai.decision("triage", {
          decider: jev,
          otherwise: "abstain",
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
          const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
          ai.decision("triage", {
            decider: jev,
            otherwise: "abstain",
            ask: { rank: ai.score("rank", missing) },
          });
        `,
      }),
    ).rejects.toThrow(/same-file const/);
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          const jev = ai.decider("jev", { provider: "openrouter", model: "m" });
          ai.decision("triage", {
            decider: jev,
            otherwise: "abstain",
            ask: { team: missingQuestion },
          });
        `,
      }),
    ).rejects.toThrow(/not a same-file const/);
  });

  test("a string passed as decider fails to compile", async () => {
    await expect(
      extractFromSources({
        "src/flows/run.ts": `
          ai.decision("triage", {
            decider: "jev",
            otherwise: "abstain",
            ask: { team: ai.choice("which", { a: "A" }) },
          });
        `,
      }),
    ).rejects.toThrow(/not a decider/);
  });
});
