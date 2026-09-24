/**
 * Opt-in OpenRouter decision smoke check.
 *
 * Skipped unless `OPENROUTER_API_KEY` is set. `bun run test` (CI) ignores
 * `*.live.test.ts`. The key is never printed, logged, or written.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ai, resetAiDecls } from "../../ai.ts";
import { createFx } from "../../../kernel/fx.ts";
import { resetDecisionCertificates } from "./certificate.ts";
import { OPENROUTER_DECISION_URL } from "./openrouter.ts";
import { resetDecisionProvider } from "../../../kernel/fx-decide.ts";

function openRouterKey(): string | undefined {
  const fromEnv = process.env["OPENROUTER_API_KEY"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const text = readFileSync(resolve(import.meta.dir, "../../../../.env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("OPENROUTER_API_KEY=")) continue;
      const value = trimmed.slice("OPENROUTER_API_KEY=".length).replace(/^["']|["']$/g, "");
      if (value.length > 0) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const apiKey = process.env["CI"] === "true" ? undefined : openRouterKey();

afterEach(() => {
  resetAiDecls();
  resetDecisionCertificates();
  resetDecisionProvider();
});

function decision() {
  return ai.decision("triage-live", {
    onUncertain: "abstain",
    ask: {
      team: ai.choice("Which team should own this ticket?", {
        billing: "Payments and refunds",
        technical: "Bugs and outages",
      }),
      severity: ai.score("How severe is this?", ["low", "medium", "high"]),
      urgent: ai.boolean("Does this need a person today?"),
    },
  });
}

function fx() {
  return createFx({
    flow: "triage.live",
    effects: { decides: ["triage-live"], secrets: ["OPENROUTER_API_KEY"] },
    secrets: { OPENROUTER_API_KEY: apiKey ?? "" },
  });
}

describe.skipIf(apiKey === undefined)("openrouter decisions live", () => {
  test("fx.decide hits /api/alpha/decisions and the body matches the fixture fields", async () => {
    const original = globalThis.fetch;
    let seenUrl = "";
    let raw: unknown;
    globalThis.fetch = async (input, init) => {
      seenUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const res = await original(input, init);
      const text = await res.clone().text();
      raw = JSON.parse(text) as unknown;
      return res;
    };
    try {
      const decl = decision();
      const result = (await fx().decide(decl, {
        ticket: "Checkout is blank after Pay.",
      })) as {
        $: {
          team: { raw: unknown };
          severity: { raw: unknown };
          urgent: { raw: unknown };
        };
      };
      expect(seenUrl).toBe(OPENROUTER_DECISION_URL);
      expect(raw && typeof raw === "object").toBe(true);
      const body = raw as {
        model?: unknown;
        answers?: Record<string, Record<string, unknown>>;
        usage?: Record<string, unknown>;
      };
      expect(typeof body.model).toBe("string");
      expect(String(body.model)).toMatch(/\d+\.\d+/);
      const team = body.answers?.team;
      const severity = body.answers?.severity;
      const urgent = body.answers?.urgent;
      expect(team?.type).toBe("choice");
      expect(team?.probabilities && typeof team.probabilities).toBe("object");
      expect(typeof team?.confidence).toBe("number");
      expect(severity?.type).toBe("score");
      expect(severity?.probabilities && typeof severity.probabilities).toBe("object");
      expect(severity?.legend && typeof severity.legend).toBe("object");
      expect(typeof severity?.confidence).toBe("number");
      expect(urgent?.type).toBe("noul");
      expect(typeof urgent?.noul).toBe("number");
      expect(body.usage && typeof body.usage).toBe("object");
      expect(result.$.team.raw).toBeDefined();

      const english = (await fx().decide(decl, {
        ticket: "Checkout is blank after Pay.",
      })) as typeof result;
      const arabic = (await fx().decide(decl, {
        ticket: "صفحة الدفع فاضية بعد ما دفعت.",
      })) as typeof result;
      console.log(
        "openrouter probabilities",
        JSON.stringify({
          en: {
            team: english.$.team.raw,
            severity: english.$.severity.raw,
            urgent: english.$.urgent.raw,
          },
          ar: {
            team: arabic.$.team.raw,
            severity: arabic.$.severity.raw,
            urgent: arabic.$.urgent.raw,
          },
        }),
      );
    } finally {
      globalThis.fetch = original;
    }
  }, 120_000);
});
