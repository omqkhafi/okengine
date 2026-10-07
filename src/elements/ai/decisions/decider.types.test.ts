/**
 * Type checks for decider capabilities and reserved fields.
 * The invalid calls are not executed.
 */

import { describe, expect, test } from "bun:test";
import { ai } from "../../ai.ts";

function typeChecks(): void {
  const jev = ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
  const narrow = ai.decider("narrow", {
    driverId: "systemone",
    baseUrl: "https://example.test/decisions",
    model: "m",
    secret: "KEY",
    capabilities: { boolean: true, choice: false, score: false, refusal: false },
  });

  ai.decision("missing-decider", {
    otherwise: "abstain",
    // @ts-expect-error decider is required, so the questions do not typecheck
    ask: { team: ai.choice("which", { a: "A" }) },
  });

  // @ts-expect-error otherwise is required
  ai.decision("missing-otherwise", {
    decider: jev,
    ask: { team: ai.choice("which", { a: "A" }) },
  });

  ai.decision("shadowed", {
    decider: jev,
    otherwise: "abstain",
    ask: { team: ai.choice("which", { a: "A" }) },
    // @ts-expect-error shadow is planned
    shadow: [],
  });

  ai.decision("too-wide", {
    decider: narrow,
    otherwise: "abstain",
    ask: {
      // @ts-expect-error this decider cannot answer a choice
      team: ai.choice("which", { a: "A" }),
    },
  });
}

void typeChecks;

describe("decider types", () => {
  test("a preset decider accepts a choice", () => {
    const jev = ai.decider("jev-ok", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
    const decl = ai.decision("ok", {
      decider: jev,
      otherwise: "abstain",
      ask: { team: ai.choice("which", { a: "A" }) },
    });
    expect(decl.decider).toBe("jev-ok");
    expect(decl.otherwise).toBe("abstain");
  });
});
