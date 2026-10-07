/**
 * Backup, breaker, lock version, expiry, and scripted answers.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, resetAiDecls } from "../../ai.ts";
import { createFx } from "../../../kernel/fx.ts";
import { flow } from "../../../kernel/flow.ts";
import { oke } from "../../../kernel/app.ts";
import { resetBindings } from "../../../kernel/on.ts";
import { http } from "../../../kernel/triggers.ts";
import { createTestApp } from "../../../test/create-test-app.ts";
import {
  DecisionLockVersionError,
  parseDecisionLockfile,
  questionHash,
  resetDecisionCertificates,
  setDecisionLock,
} from "./certificate.ts";
import { resetDecisionBreakers, decisionBreakerOpen } from "./http.ts";
import { DecisionInputTooLarge, DecisionOutageError, DecisionRequestError } from "./provider.ts";
import { resetDecisionProvider, setDecisionProvider } from "../../../kernel/fx-decide.ts";

afterEach(() => {
  resetBindings();
  resetAiDecls();
  resetDecisionCertificates();
  resetDecisionProvider();
  resetDecisionBreakers();
});

function choice() {
  return ai.choice("which team", { billing: "Billing", technical: "Technical" });
}

function cert(model: string, question: ReturnType<typeof choice>) {
  return {
    model,
    pinned: true as const,
    questions: {
      team: {
        "": {
          hash: questionHash(question),
          calibrator: { kind: "temperature" as const, t: 1 },
          threshold: 0.5,
        },
      },
    },
  };
}

function answer(model: string) {
  return {
    model,
    answers: {
      team: {
        type: "choice",
        choice: "technical",
        probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
      },
    },
    usage: {},
  };
}

describe("decider runtime", () => {
  test("a certified backup answers as auto and names itself", async () => {
    const question = choice();
    const primary = ai.decider("primary", { provider: "openrouter", model: "primary-model" });
    const spare = ai.decider("spare", { provider: "openrouter", model: "spare-model" });
    const decl = ai.decision("triage", {
      decider: primary,
      backup: [spare],
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      version: 2,
      decisions: { triage: { deciders: { spare: cert("spare-model", question) } } },
    });
    setDecisionProvider(async (_decl, _input, _signal, decider) => {
      if (decider?.name === "primary") throw new DecisionOutageError("down");
      return answer("spare-model");
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    const result = (await fx.decide(decl, {})) as {
      team: string;
      $: { team: { how: string; by: string; why?: string } };
    };
    expect(result.team).toBe("technical");
    expect(result.$.team).toMatchObject({ how: "auto", by: "spare" });
    expect(result.$.team.why).toBeUndefined();
  });

  test("an uncertified backup takes otherwise", async () => {
    const primary = ai.decider("primary", { provider: "openrouter", model: "primary-model" });
    const spare = ai.decider("spare", { provider: "openrouter", model: "spare-model" });
    const decl = ai.decision("triage", {
      decider: primary,
      backup: [spare],
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: choice() },
    });
    setDecisionProvider(async (_decl, _input, _signal, decider) => {
      if (decider?.name === "primary") throw new DecisionOutageError("down");
      return answer("spare-model");
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    const result = (await fx.decide(decl, {})) as {
      team: null;
      $: { team: { why: string; by: string } };
    };
    expect(result.team).toBeNull();
    expect(result.$.team).toMatchObject({ why: "uncertified", by: "spare" });
  });

  test("a 4xx does not open the breaker or try the backup", async () => {
    const primary = ai.decider("primary", { provider: "openrouter", model: "primary-model" });
    const spare = ai.decider("spare", { provider: "openrouter", model: "spare-model" });
    const decl = ai.decision("triage", {
      decider: primary,
      backup: [spare],
      otherwise: "abstain",
      ask: { team: choice() },
    });
    const original = globalThis.fetch;
    let spareHits = 0;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        model?: string;
      };
      if (body.model === "spare-model") spareHits += 1;
      return new Response("no", { status: 422 });
    }) as typeof fetch;
    try {
      const fx = createFx({
        flow: "run",
        effects: { decides: ["triage"], secrets: ["OPENROUTER_API_KEY"] },
        secrets: { OPENROUTER_API_KEY: "test-key" },
      });
      await expect(fx.decide(decl, {})).rejects.toBeInstanceOf(DecisionRequestError);
      expect(spareHits).toBe(0);
      expect(decisionBreakerOpen("primary")).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("the breaker opens on the primary and the next call skips it", async () => {
    const question = choice();
    const primary = ai.decider("primary", { provider: "openrouter", model: "primary-model" });
    const spare = ai.decider("spare", { provider: "openrouter", model: "spare-model" });
    const decl = ai.decision("triage", {
      decider: primary,
      backup: [spare],
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      version: 2,
      decisions: { triage: { deciders: { spare: cert("spare-model", question) } } },
    });
    const original = globalThis.fetch;
    let primaryHits = 0;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        model?: string;
      };
      if (body.model === "primary-model") {
        primaryHits += 1;
        return new Response("down", { status: 500 });
      }
      return new Response(JSON.stringify(answer("spare-model")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const fx = createFx({
        flow: "run",
        effects: { decides: ["triage"], secrets: ["OPENROUTER_API_KEY"] },
        secrets: { OPENROUTER_API_KEY: "test-key" },
      });
      for (let i = 0; i < 3; i += 1) {
        const result = (await fx.decide(decl, {})) as { $: { team: { by: string } } };
        expect(result.$.team.by).toBe("spare");
      }
      expect(decisionBreakerOpen("primary")).toBe(true);
      const skipped = (await fx.decide(decl, {})) as { team: string; $: { team: { by: string } } };
      expect(primaryHits).toBe(3);
      expect(skipped.team).toBe("technical");
      expect(skipped.$.team.by).toBe("spare");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("version 1 lockfiles ask for recertify", () => {
    expect(() =>
      parseDecisionLockfile({
        version: 1,
        decisions: { triage: { model: "m", questions: {} } },
      }),
    ).toThrow(DecisionLockVersionError);
    expect(() =>
      parseDecisionLockfile({
        version: 1,
        decisions: { triage: { model: "m", questions: {} } },
      }),
    ).toThrow(/recertify/);
  });

  test("a different echoed model is uncertified", async () => {
    const question = choice();
    const jev = ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
    const decl = ai.decision("triage", {
      decider: jev,
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      version: 2,
      decisions: { triage: { deciders: { jev: cert("typesafe/jev-1.13.0", question) } } },
    });
    setDecisionProvider(async () => answer("typesafe/jev-1.13-20260917"));
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    const result = (await fx.decide(decl, {})) as { $: { team: { why: string } } };
    expect(result.$.team.why).toBe("uncertified");
  });

  test("an expired alias certificate is uncertified", async () => {
    const question = choice();
    const luna = ai.decider("luna", { provider: "openai", model: "gpt-6-luna" });
    const decl = ai.decision("triage", {
      decider: luna,
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const slice = cert("gpt-6-luna", question);
    setDecisionLock({
      version: 2,
      decisions: {
        triage: {
          deciders: {
            luna: { ...slice, pinned: false, expiresAt: 1_000 },
          },
        },
      },
    });
    setDecisionProvider(async () => answer("gpt-6-luna"));
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] }, now: () => 1_000 });
    const result = (await fx.decide(decl, {})) as { $: { team: { why: string; by: string } } };
    expect(result.$.team).toMatchObject({ why: "uncertified", by: "luna" });
  });

  test("switching to an already certified decider does not need another certificate", async () => {
    const question = choice();
    const spare = ai.decider("spare", { provider: "openrouter", model: "spare-model" });
    const decl = ai.decision("triage", {
      decider: spare,
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      version: 2,
      decisions: { triage: { deciders: { spare: cert("spare-model", question) } } },
    });
    setDecisionProvider(async () => answer("spare-model"));
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    const result = (await fx.decide(decl, {})) as {
      team: string;
      $: { team: { how: string; by: string } };
    };
    expect(result.team).toBe("technical");
    expect(result.$.team).toMatchObject({ how: "auto", by: "spare" });
  });

  test("state past max context throws before any call", async () => {
    const small = ai.decider("small", {
      driverId: "systemone",
      baseUrl: "https://example.test/decisions",
      model: "m",
      secret: "KEY",
      capabilities: {
        boolean: true,
        choice: true,
        score: false,
        refusal: false,
        maxContext: 1,
      },
    });
    const decl = ai.decision("triage", {
      decider: small,
      otherwise: "abstain",
      ask: { team: choice() },
    });
    let called = false;
    setDecisionProvider(async () => {
      called = true;
      return answer("m");
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    await expect(fx.decide(decl, { ticket: "1234567890" })).rejects.toBeInstanceOf(
      DecisionInputTooLarge,
    );
    expect(called).toBe(false);
  });

  test("refusal and none_of_these take otherwise and store no refusal text", async () => {
    const question = choice();
    const jev = ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
    const decl = ai.decision("triage", {
      decider: jev,
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionProvider(async () => ({
      model: "typesafe/jev-1.13.0",
      answers: { team: { type: "refusal", text: "nope" } },
      usage: {},
    }));
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] } });
    const refused = (await fx.decide(decl, {})) as {
      team: null;
      $: { team: { why: string; by: string; raw: unknown } };
    };
    expect(refused.team).toBeNull();
    expect(refused.$.team).toMatchObject({ why: "refused", by: "jev", raw: { type: "refusal" } });
    expect(JSON.stringify(refused)).not.toContain("nope");

    setDecisionLock({
      version: 2,
      decisions: {
        triage: { deciders: { jev: cert("typesafe/jev-1.13.0", question) } },
      },
    });
    setDecisionProvider(async () => ({
      model: "typesafe/jev-1.13.0",
      answers: {
        team: {
          type: "choice",
          choice: "none_of_these",
          probabilities: { billing: 0.1, technical: 0.1, none_of_these: 0.8 },
        },
      },
      usage: {},
    }));
    const missed = (await fx.decide(decl, {})) as { team: null; $: { team: { why: string } } };
    expect(missed.team).toBeNull();
    expect(missed.$.team.why).toBe("none_of_these");
  });

  test("t.ai.decide scripts probabilities and a refusal", async () => {
    const question = choice();
    const jev = ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
    const triage = ai.decision("scripted", {
      decider: jev,
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const work = flow("work", {
      effects: { decides: ["scripted"] },
      do: async (_input: unknown, fx) => fx.decide(triage, { ticket: "1" }),
    });
    const root = await mkdtemp(join(tmpdir(), "oke-script-"));
    const app = oke({
      name: "scripted",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      rootDir: root,
      bindings: [{ trigger: http.post("/work"), flow: work }],
    });
    const t = await createTestApp(app, {
      capability: "open",
      boot: { rootDir: root },
    });
    try {
      setDecisionLock({
        version: 2,
        decisions: {
          scripted: { deciders: { jev: cert("typesafe/jev-1.13.0", question) } },
        },
      });
      t.ai.decide(triage, {
        team: { probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 } },
      });
      const auto = (await t.app.call(work, {})) as { team: string; $: { team: { how: string } } };
      expect(auto.team).toBe("technical");
      expect(auto.$.team.how).toBe("auto");

      t.ai.decide(triage, { team: { refusal: "not stored" } });
      const refused = (await t.app.call(work, {})) as {
        team: null;
        $: { team: { why: string; raw: unknown } };
      };
      expect(refused.team).toBeNull();
      expect(refused.$.team.why).toBe("refused");
      expect(JSON.stringify(refused)).not.toContain("not stored");
    } finally {
      await t.close();
    }
  });
});
