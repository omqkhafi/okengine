/**
 * fx.decide — replay, review lease, abstain, and audit.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ai, resetAiDecls } from "../../ai.ts";
import { gate, resetGates } from "../../gate/declare.ts";
import { oke } from "../../../kernel/app.ts";
import { resetBindings } from "../../../kernel/on.ts";
import type { Manifest } from "../../../manifest/types.ts";
import { questionHash, resetDecisionCertificates, setDecisionLock } from "./certificate.ts";
import { createFx } from "../../../kernel/fx.ts";
import {
  createJournal,
  createMemoryJournalStore,
  isJournalSuspend,
} from "../../../kernel/journal.ts";
import {
  createPostgresJournalFake,
  createPostgresJournalStore,
} from "../../../drivers/journal-postgres.ts";
import { DecisionConfigError, DecisionOutageError } from "./provider.ts";
import {
  decisionProviderCalls,
  decisionStepName,
  readDecisionReview,
  resetDecisionProvider,
  resolveDecisionReview,
  setDecisionProvider,
} from "../../../kernel/fx-decide.ts";

afterEach(() => {
  resetBindings();
  resetAiDecls();
  resetDecisionCertificates();
  resetDecisionProvider();
  resetGates();
});

function choice() {
  return ai.choice("which team", { billing: "Billing", technical: "Technical" });
}

function provider() {
  setDecisionProvider(async () => ({
    model: "typesafe/jev-1.13.0",
    provider: "openrouter",
    answers: {
      team: {
        type: "choice",
        choice: "technical",
        probabilities: { billing: 0.08, technical: 0.9, none_of_these: 0.02 },
      },
    },
    usage: { inputTokens: 10, outputTokens: 2 },
  }));
}

describe("fx.decide", () => {
  test("replay makes one provider call", async () => {
    provider();
    const question = choice();
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      decisions: {
        triage: {
          model: "typesafe/jev-1.13.0",
          questions: {
            team: {
              "": {
                hash: questionHash(question),
                calibrator: { kind: "temperature" as const, t: 1 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
    const store = createMemoryJournalStore();
    const session = await createJournal({ store, now: () => 1_000_000 }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      now: () => 1_000_000,
    });
    const first = (await fx.decide(decl, { ticket: "1" })) as {
      team: string;
      $: { team: { how: string; audited?: boolean } };
    };
    expect(first.team).toBe("technical");
    expect(first.$.team.how).toBe("auto");
    expect(first.$.team.audited).toBeUndefined();
    expect(decisionProviderCalls()).toBe(1);
    session.rewind();
    const second = (await fx.decide(decl, { ticket: "1" })) as { team: string };
    expect(second.team).toBe("technical");
    expect(decisionProviderCalls()).toBe(1);
  });

  test("abstain in a non-durable flow returns null and does not park", async () => {
    setDecisionProvider(async () => {
      throw new DecisionOutageError("down");
    });
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      ask: { team: choice() },
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] }, now: () => 1 });
    const result = (await fx.decide(decl, {})) as {
      team: string | null;
      $: { team: { how: string } };
    };
    expect(result.team).toBeNull();
    expect(result.$.team.how).toBe("abstained");
    expect(result.$.team.how).not.toBe("audited");
  });

  test("audit returns the auto value and journals one label review", async () => {
    provider();
    const question = choice();
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 1 },
      ask: { team: question },
    });
    setDecisionLock({
      decisions: {
        triage: {
          model: "typesafe/jev-1.13.0",
          questions: {
            team: {
              "": {
                hash: questionHash(question),
                calibrator: { kind: "temperature" as const, t: 1 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
    const store = createMemoryJournalStore();
    const session = await createJournal({ store, now: () => 1_000_000 }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      now: () => 1_000_000,
    });
    const result = (await fx.decide(decl, {})) as {
      team: string;
      $: { team: { how: string; audited?: boolean } };
    };
    expect(result.team).toBe("technical");
    expect(result.$.team.how).toBe("auto");
    expect(result.$.team.audited).toBe(true);
    const labels = session.run.entries.filter(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision-label:"),
    );
    expect(labels).toHaveLength(1);
    const sleeps = session.run.entries.filter((entry) => entry.kind === "sleep");
    expect(sleeps).toHaveLength(0);
  });

  test("two concurrent resolves, then a finished review conflicts", async () => {
    provider();
    gate.policy("ops", (ctx) => ctx.operator.id !== null);
    const decl = ai.decision("triage", {
      review: "ops",
      ask: { team: choice() },
    });
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const now = () => 1_000_000;
    const session = await createJournal({ store, now }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      durable: true,
      now,
    });
    let suspended = false;
    try {
      await fx.decide(decl, {});
    } catch (err) {
      suspended = isJournalSuspend(err);
      if (!suspended) throw err;
    }
    expect(suspended).toBe(true);
    const step = session.run.entries.find(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    if (!step || step.kind !== "step") throw new Error("expected a parked decision");
    const id = step.name.slice("ai-decision:".length);
    expect(decisionStepName(id)).toBe(step.name);
    const [left, right] = await Promise.all([
      resolveDecisionReview(store, id, { values: { team: "billing" }, reviewer: "a" }, now),
      resolveDecisionReview(store, id, { values: { team: "technical" }, reviewer: "b" }, now),
    ]);
    const wins = [left, right].filter((result) => result.ok);
    const lost = [left, right].filter((result) => !result.ok);
    expect(wins).toHaveLength(1);
    expect(lost).toEqual([{ ok: false, status: 409, reason: "lease", retryAfterSeconds: 30 }]);
    expect(
      await resolveDecisionReview(store, id, { values: { team: "billing" }, reviewer: "c" }, now),
    ).toEqual({ ok: false, status: 409, reason: "resolved" });
    expect((await readDecisionReview(store, id))?.status).toBe("reviewed");
  });

  test("boot registers the candidate route when a decision has autonomy", async () => {
    const manifest = {
      oke: "1",
      app: "decide-boot",
      ai: {
        decisions: {
          triage: {
            mode: "review",
            questions: ["team"],
            autonomy: { maxError: 0.05, audit: 0.1 },
          },
        },
      },
    } as unknown as Manifest;
    const app = oke({
      name: "decide-boot",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      gate: { unguardedHttp: "allow" },
      manifest,
    });
    await app.boot({ env: "test" });
    const res = await app.fetch(new Request("http://localhost/_oke/decisions/triage/candidate"));
    expect(res.status).toBeLessThan(500);
    await app.bootResult?.close();
  });

  test("replay returns the journaled projection after the lock changes", async () => {
    provider();
    const question = choice();
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      decisions: {
        triage: {
          model: "typesafe/jev-1.13.0",
          questions: {
            team: {
              "": {
                hash: questionHash(question),
                calibrator: { kind: "temperature" as const, t: 1 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
    const store = createMemoryJournalStore();
    const session = await createJournal({ store, now: () => 1_000_000 }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      now: () => 1_000_000,
    });
    const first = (await fx.decide(decl, {})) as { team: string; $: { team: { how: string } } };
    expect(first.$.team.how).toBe("auto");
    setDecisionLock(undefined);
    session.rewind();
    const second = (await fx.decide(decl, {})) as { team: string; $: { team: { how: string } } };
    expect(second.team).toBe("technical");
    expect(second.$.team.how).toBe("auto");
    expect(decisionProviderCalls()).toBe(1);
  });

  test("the same decision can park twice in one run", async () => {
    provider();
    gate.policy("ops", (ctx) => ctx.operator.id !== null);
    const decl = ai.decision("triage", { review: "ops", ask: { team: choice() } });
    const store = createMemoryJournalStore();
    const journal = createJournal({ store, now: () => 1_000_000 });
    const session = await journal.start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      durable: true,
      now: () => 1_000_000,
    });
    const park = async () => {
      try {
        await fx.decide(decl, {});
        return false;
      } catch (err) {
        if (!isJournalSuspend(err)) throw err;
        return true;
      }
    };
    expect(await park()).toBe(true);
    const first = session.run.entries.find(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    if (!first || first.kind !== "step") throw new Error("expected the first park");
    await resolveDecisionReview(
      store,
      first.name.slice("ai-decision:".length),
      { values: { team: "billing" }, reviewer: "a" },
      () => 1_000_000,
    );
    const resumed = await journal.resume(session.runId);
    const again = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: resumed,
      runId: resumed.runId,
      durable: true,
      now: () => 1_000_001,
    });
    const done = (await again.decide(decl, {})) as { team: string; $: { team: { how: string } } };
    expect(done.team).toBe("billing");
    expect(done.$.team.how).toBe("reviewed");
    let secondPark = false;
    try {
      await again.decide(decl, {});
    } catch (err) {
      secondPark = isJournalSuspend(err);
      if (!secondPark) throw err;
    }
    expect(secondPark).toBe(true);
    const steps = resumed.run.entries.filter(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    expect(steps).toHaveLength(2);
  });

  test("none_of_these is not auto", async () => {
    setDecisionProvider(async () => ({
      model: "typesafe/jev-1.13.0",
      provider: "openrouter",
      answers: {
        team: {
          type: "choice",
          choice: "none_of_these",
          probabilities: { billing: 0.1, technical: 0.1, none_of_these: 0.8 },
        },
      },
      usage: {},
    }));
    const question = choice();
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    setDecisionLock({
      decisions: {
        triage: {
          model: "typesafe/jev-1.13.0",
          questions: {
            team: {
              "": {
                hash: questionHash(question),
                calibrator: { kind: "temperature" as const, t: 1 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] }, now: () => 1 });
    const result = (await fx.decide(decl, {})) as { team: null; $: { team: { how: string } } };
    expect(result.team).toBeNull();
    expect(result.$.team.how).toBe("abstained");
  });

  test("boolean value follows the calibrated probability", async () => {
    setDecisionProvider(async () => ({
      model: "typesafe/jev-1.13.0",
      provider: "openrouter",
      answers: { urgent: { type: "noul", noul: 0.2 } },
      usage: {},
    }));
    const question = ai.boolean("urgent?");
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { urgent: question },
    });
    setDecisionLock({
      decisions: {
        triage: {
          model: "typesafe/jev-1.13.0",
          questions: {
            urgent: {
              "": {
                hash: questionHash(question),
                calibrator: { kind: "platt" as const, a: 1, b: 0 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
    const fx = createFx({ flow: "run", effects: { decides: ["triage"] }, now: () => 1 });
    const result = (await fx.decide(decl, {})) as { urgent: boolean };
    expect(result.urgent).toBe(false);
  });

  test("resolve checks the gate, the tenant, and every open question", async () => {
    provider();
    gate.policy("ops", (ctx) => ctx.operator.id === "reviewer");
    const decl = ai.decision("triage", { review: "ops", ask: { team: choice() } });
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const session = await createJournal({ store, now: () => 1 }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      durable: true,
      tenant: { id: "acme" },
      now: () => 1,
    });
    try {
      await fx.decide(decl, {});
    } catch (err) {
      if (!isJournalSuspend(err)) throw err;
    }
    const step = session.run.entries.find(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    if (!step || step.kind !== "step") throw new Error("expected a parked decision");
    const id = step.name.slice("ai-decision:".length);
    expect((step.value as { propensity: number }).propensity).toBe(1);
    expect(
      await resolveDecisionReview(store, id, {
        values: { team: "billing" },
        reviewer: "other",
        tenantId: "acme",
      }),
    ).toEqual({ ok: false, status: 403 });
    expect(
      await resolveDecisionReview(store, id, {
        values: { team: "billing" },
        reviewer: "reviewer",
        tenantId: "other",
      }),
    ).toEqual({ ok: false, status: 403 });
    expect(
      await resolveDecisionReview(store, id, {
        values: { team: "nope", extra: true },
        reviewer: "reviewer",
        tenantId: "acme",
      }),
    ).toEqual({ ok: false, status: 422 });
    expect(
      await resolveDecisionReview(store, id, {
        values: { team: "billing" },
        reviewer: "reviewer",
        tenantId: "acme",
      }),
    ).toEqual({ ok: true });
  });

  test("pending review stamps the tenant", async () => {
    provider();
    const decl = ai.decision("triage", { review: "ops", ask: { team: choice() } });
    const store = createMemoryJournalStore();
    const session = await createJournal({ store, now: () => 1 }).start("run", {});
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      durable: true,
      tenant: { id: "acme" },
      now: () => 1,
    });
    try {
      await fx.decide(decl, {});
    } catch (err) {
      if (!isJournalSuspend(err)) throw err;
    }
    const step = session.run.entries.find(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    if (!step || step.kind !== "step") throw new Error("expected a parked decision");
    expect((step.value as { tenant: string }).tenant).toBe("acme");
  });

  test("a missing secret is a config error", async () => {
    const decl = ai.decision("triage", { onUncertain: "abstain", ask: { team: choice() } });
    const fx = createFx({
      flow: "run",
      effects: { decides: ["triage"], secrets: ["OPENROUTER_API_KEY"] },
      now: () => 1,
    });
    await expect(fx.decide(decl, {})).rejects.toBeInstanceOf(DecisionConfigError);
  });
});
