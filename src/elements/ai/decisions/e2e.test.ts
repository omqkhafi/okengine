/**
 * Decision autonomy from certify through boot, review, and promote.
 * The app restarts between steps. Labels and the drift flag stay on disk.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, resetAiDecls } from "../../ai.ts";
import { runOkeCertify } from "../../../cli/eval.ts";
import { promoteDecision } from "../../../cli/decide.ts";
import { gate, resetGates } from "../../gate/declare.ts";
import {
  decisionDriftSuspended,
  getDecisionLock,
  loadDecisionLockfile,
  resetDecisionCertificates,
} from "./certificate.ts";
import {
  closeDecisionLabelStore,
  flushDecisionLabels,
  loadDecisionLabels,
  persistDecisionLabel,
} from "./labels.ts";
import { oke } from "../../../kernel/app.ts";
import { flow } from "../../../kernel/flow.ts";
import { signal } from "../../signal/declare.ts";
import { resetBindings } from "../../../kernel/on.ts";
import { http } from "../../../kernel/triggers.ts";
import type { Manifest } from "../../../manifest/types.ts";
import { resetDecisionProvider, setDecisionProvider } from "../../../kernel/fx-decide.ts";
import { DECISION_DRIFT_SIGNAL, decisionOperatorGate } from "./bind.ts";
import { consoleOperatorGate } from "../../../console/server/console-gates.ts";
import { decisionConsoleBindings } from "../../../console/server/decisions-flows.ts";
import type { ConsoleState } from "../../../console/server/state.ts";
import {
  createPostgresJournalFake,
  createPostgresJournalStore,
} from "../../../drivers/journal-postgres.ts";

afterEach(() => {
  closeDecisionLabelStore();
  resetBindings();
  resetAiDecls();
  resetGates();
  resetDecisionCertificates();
  resetDecisionProvider();
});

function providerBody() {
  return {
    model: "typesafe/jev-1.13.0",
    provider: "openrouter",
    answers: {
      team: {
        type: "choice" as const,
        choice: "technical",
        probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
      },
    },
    usage: {},
  };
}

describe("fx.decide end to end", () => {
  test("boot without a project root fails when decisions are declared", async () => {
    const app = oke({
      name: "decide-no-root",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest: {
        oke: "1",
        app: "decide-no-root",
        ai: {
          decisions: {
            triage: { mode: "abstain", questions: ["team"] },
          },
        },
      } as unknown as Manifest,
    });
    await expect(app.boot({ env: "test" })).rejects.toThrow(/rootDir/);
  });

  test("certify, review, drift, and promote use the real routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-decide-e2e-"));
    const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    const ship = ai.decision("ship", {
      onUncertain: "abstain",
      model: "typesafe/jev-1.13.0",
      autonomy: { maxError: 0.05, audit: 0 },
      evals: join(root, "ship.jsonl"),
      ask: { team: question },
    });
    const ops = gate.policy("ops", (ctx) => ctx.operator.id === "reviewer");
    const triage = ai.decision("triage", {
      review: "ops",
      model: "typesafe/jev-1.13.0",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const route = ai.decision("route", {
      review: "ops",
      model: "typesafe/jev-1.13.0",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const seed = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({
        input: { ticket: `T-${i}`, note: `Customer ${i} cannot sign in after the deploy` },
        expect: { team: "technical" },
      }),
    ).join("\n");
    let certifyCalls = 0;
    await Bun.write(join(root, "ship.jsonl"), seed);
    const manifest = {
      oke: "1",
      app: "decide-e2e",
      ai: {
        decisions: {
          ship: {
            mode: "abstain",
            questions: ["team"],
            model: "typesafe/jev-1.13.0",
            evals: join(root, "ship.jsonl"),
            autonomy: { maxError: 0.05, audit: 0 },
          },
          triage: {
            mode: "review",
            questions: ["team"],
            review: "ops",
            model: "typesafe/jev-1.13.0",
            autonomy: { maxError: 0.05, audit: 0 },
          },
          route: {
            mode: "review",
            questions: ["team"],
            review: "ops",
            model: "typesafe/jev-1.13.0",
            autonomy: { maxError: 0.05, audit: 0 },
          },
        },
      },
    } as unknown as Manifest;
    const code = await runOkeCertify({
      root,
      manifest,
      evaluate: async () => {
        const technical = 0.62 + (certifyCalls++ % 30) / 100;
        return {
          ...providerBody(),
          answers: {
            team: {
              type: "choice" as const,
              choice: "technical",
              probabilities: {
                billing: Number((1 - technical - 0.02).toFixed(4)),
                technical: Number(technical.toFixed(4)),
                none_of_these: 0.02,
              },
            },
          },
        };
      },
    });
    expect(code).toBe(0);

    setDecisionProvider(async () => providerBody());
    const sql = createPostgresJournalFake();
    const store = await createPostgresJournalStore({ sql });
    const consoleState = { journalStore: store, manifest } as ConsoleState;
    const resolve = decisionConsoleBindings(consoleState).find(
      (binding) => binding.flow.name === "console.decisions.resolve",
    );
    if (!resolve) throw new Error("expected the console resolve route");
    const work = flow("work", {
      durable: true,
      effects: { decides: ["ship", "triage", "route"] },
      do: async (input: { which: "ship" | "triage" | "route" }, fx) =>
        fx.decide(input.which === "ship" ? ship : input.which === "route" ? route : triage, {
          ticket: "1",
        }),
    });

    const locked = oke({
      name: "decide-e2e",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest,
      rootDir: root,
      signals: [
        signal.once(DECISION_DRIFT_SIGNAL, { optional: true, retries: 0, deadLetter: false }),
      ],
      fx: { operator: { id: "reviewer" } },
      elements: { journal: { store, instanceId: "e2e", leaseMs: 30_000, driverId: "memory" } },
      gate: {
        unguardedHttp: "allow",
        policies: [consoleOperatorGate, decisionOperatorGate, ops],
      },
      bindings: [resolve, { trigger: http.post("/work"), flow: work }],
    });
    await locked.boot({ env: "test" });
    const auto = (await locked.call(work, { which: "ship" })) as {
      team: string;
      $: { team: { how: string } };
    };
    expect(auto.team).toBe("technical");
    expect(auto.$.team.how).toBe("auto");
    expect(getDecisionLock()?.decisions.ship?.model).toBe("typesafe/jev-1.13.0");

    await locked.call(work, { which: "triage" });
    const run = (await store.list()).find((item) =>
      item.entries.some((entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:")),
    );
    const step = run?.entries.find(
      (entry) => entry.kind === "step" && entry.name.startsWith("ai-decision:"),
    );
    if (!run || !step || step.kind !== "step") throw new Error("expected a parked review");
    const review = await locked.fetch(
      new Request("http://localhost/console/decisions/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: step.name.slice("ai-decision:".length),
          values: { team: "billing" },
        }),
      }),
    );
    expect(review.status).toBe(200);
    await flushDecisionLabels();
    await locked.resumeDurable(Date.now() + 1);
    const finished = await store.get(run.id);
    const output = finished?.output as { team: string; $: { team: { how: string } } } | undefined;
    expect(output?.team).toBe("billing");
    expect(output?.$.team.how).toBe("reviewed");

    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      persistDecisionLabel({
        decision: "ship",
        question: "team",
        value: "billing",
        propensity: 0.1,
        reviewer: "audit",
        model: "typesafe/jev-1.13.0",
        loss: 1,
        score: 0.9,
        at: now,
      });
    }
    await flushDecisionLabels();
    const drift = locked.flow("oke.decisions.drift");
    if (!drift) throw new Error("expected the drift monitor");
    await locked.call(drift, {});
    expect(decisionDriftSuspended()).toBe(true);

    const aggregate = locked.flow("oke.decisions.aggregate");
    if (!aggregate) throw new Error("expected the candidate job");
    await locked.call(aggregate, {});
    const thin = await locked.fetch(
      new Request("http://localhost/_oke/decisions/triage/candidate"),
    );
    expect(thin.status).toBe(200);
    const thinBody = (await thin.json()) as {
      data?: { questions?: Record<string, unknown> };
      questions?: Record<string, unknown>;
    };
    const thinQuestions = thinBody.data?.questions ?? thinBody.questions ?? {};
    expect(thinQuestions.team).toBeUndefined();
    await locked.call(work, { which: "triage" });
    const still = (await store.list()).filter((item) =>
      item.entries.some(
        (entry) =>
          entry.kind === "step" &&
          entry.name.startsWith("ai-decision:") &&
          (entry.value as { status?: string }).status === "pending",
      ),
    );
    expect(still.length).toBeGreaterThan(0);

    for (let i = 0; i < 160; i++) {
      await locked.call(work, { which: "route" });
      const parked = (await store.list()).find((item) =>
        item.entries.some(
          (entry) =>
            entry.kind === "step" &&
            entry.name.startsWith("ai-decision:") &&
            (entry.value as { status?: string }).status === "pending",
        ),
      );
      const parkedStep = parked?.entries.find(
        (entry) =>
          entry.kind === "step" &&
          entry.name.startsWith("ai-decision:") &&
          (entry.value as { status?: string }).status === "pending",
      );
      if (!parked || !parkedStep || parkedStep.kind !== "step") {
        throw new Error("expected a parked route review");
      }
      const agreed = await locked.fetch(
        new Request("http://localhost/console/decisions/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: parkedStep.name.slice("ai-decision:".length),
            values: { team: "technical" },
          }),
        }),
      );
      expect(agreed.status).toBe(200);
      await flushDecisionLabels();
      await locked.resumeDurable(Date.now() + 1);
    }

    await locked.call(aggregate, {});
    const candidate = await locked.fetch(
      new Request("http://localhost/_oke/decisions/route/candidate"),
    );
    expect(candidate.status).toBe(200);
    const candidateBody = (await candidate.json()) as {
      data?: { questions?: { team?: Record<string, unknown> } };
      questions?: { team?: Record<string, unknown> };
    };
    const routeQuestions = candidateBody.data?.questions ?? candidateBody.questions;
    expect(routeQuestions?.team?.[""]).toBeDefined();
    const promoted = await promoteDecision({
      name: "route",
      origin: "http://localhost",
      lockPath: join(root, "oke-decisions.lock.json"),
      fetcher: async (url) => {
        const res = await locked.fetch(new Request(url));
        const body = (await res.json()) as { data?: unknown };
        return new Response(JSON.stringify(body.data ?? body), { status: res.status });
      },
    });
    expect(promoted.decisions.ship).toBeDefined();
    expect(promoted.decisions.route?.questions.team?.[""]).toBeDefined();
    expect(decisionDriftSuspended()).toBe(false);
    await loadDecisionLockfile(root);
    const after = (await locked.call(work, { which: "route" })) as {
      team: string;
      $: { team: { how: string } };
    };
    expect(after.team).toBe("technical");
    expect(after.$.team.how).toBe("auto");
    await locked.bootResult?.close();

    closeDecisionLabelStore();
    resetDecisionCertificates();
    const restartedStore = await createPostgresJournalStore({ sql });
    const restarted = oke({
      name: "decide-e2e-2",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest,
      rootDir: root,
      fx: { operator: { id: "reviewer" } },
      signals: [
        signal.once(DECISION_DRIFT_SIGNAL, { optional: true, retries: 0, deadLetter: false }),
      ],
      gate: {
        unguardedHttp: "allow",
        policies: [consoleOperatorGate, decisionOperatorGate, ops],
      },
      elements: {
        journal: {
          store: restartedStore,
          instanceId: "e2e-2",
          leaseMs: 30_000,
          driverId: "memory",
        },
      },
      bindings: [{ trigger: http.post("/work"), flow: work }],
    });
    await restarted.boot({ env: "test" });
    expect((await loadDecisionLabels("route")).length).toBeGreaterThan(0);
    expect(getDecisionLock()?.decisions.route?.questions.team?.[""]).toBeDefined();
    expect(decisionDriftSuspended()).toBe(false);
    const restartedAuto = (await restarted.call(work, { which: "route" })) as {
      team: string;
      $: { team: { how: string } };
    };
    expect(restartedAuto.$.team.how).toBe("auto");
    await restarted.bootResult?.close();
  }, 60_000);
});
