/**
 * Opt-in OpenAI decisions smoke check.
 *
 * Skipped unless `OPENAI_API_KEY` is set. `bun test` ignores `*.live.test.ts`.
 * The key is never printed, logged, or written.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ai, resetAiDecls } from "../../ai.ts";
import { createFx } from "../../../kernel/fx.ts";
import { resetDecisionCertificates } from "./certificate.ts";
import { resetDecisionProvider } from "../../../kernel/fx-decide.ts";

const apiKey = process.env["CI"] === "true" ? undefined : process.env["OPENAI_API_KEY"];

afterEach(() => {
  resetAiDecls();
  resetDecisionCertificates();
  resetDecisionProvider();
});

describe.skipIf(!apiKey)("openai decisions live", () => {
  test("fx.decide posts to /v1/decisions", async () => {
    const decl = ai.decision("triage-openai", {
      decider: ai.decider("luna", { provider: "openai", model: "gpt-6-luna" }),
      otherwise: "abstain",
      ask: {
        urgent: ai.boolean("Does this need a person today?"),
      },
    });
    const fx = createFx({
      flow: "triage.openai",
      effects: { decides: ["triage-openai"], secrets: ["OPENAI_API_KEY"] },
      secrets: { OPENAI_API_KEY: apiKey ?? "" },
    });
    const result = (await fx.decide(decl, "Checkout is blank after Pay.")) as {
      $: { urgent: { by: string }; meta: { model: string } };
    };
    expect(result.$.urgent.by).toBe("luna");
    expect(result.$.meta.model.length).toBeGreaterThan(0);
  });
});
