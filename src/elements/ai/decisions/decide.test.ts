/**
 * fx.decide — replay, review lease, abstain, and audit.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ai, resetAiDecls } from "../../ai.ts";
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
});
