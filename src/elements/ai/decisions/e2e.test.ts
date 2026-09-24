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
  resetDecisionCertificates,
  setDecisionDrift,
} from "./certificate.ts";
import { closeDecisionLabelStore, loadDecisionLabels, persistDecisionDrift } from "./labels.ts";
import { oke } from "../../../kernel/app.ts";
import { createFx } from "../../../kernel/fx.ts";
import { flow } from "../../../kernel/flow.ts";
import { createJournal } from "../../../kernel/journal.ts";
import { resetBindings } from "../../../kernel/on.ts";
import { http } from "../../../kernel/triggers.ts";
import type { Manifest } from "../../../manifest/types.ts";
import { resetDecisionProvider, resolveDecisionReview, setDecisionProvider } from "../../../kernel/fx-decide.ts";
import { decisionConsoleBindings } from "../../../console/server/decisions-flows.ts";
import type { ConsoleState } from "../../../console/server/state.ts";
import {
  createPostgresJournalFake,
  createPostgresJournalStore,
} from "../../../drivers/journal-postgres.ts";

const previousCwd = process.cwd();

afterEach(() => {
  process.chdir(previousCwd);
  closeDecisionLabelStore();
  resetBindings();
  resetAiDecls();
  resetGates();
  resetDecisionCertificates();
  resetDecisionProvider();
  setDecisionDrift(false);
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
  test("certify, review, and promote survive a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-decide-e2e-"));
    process.chdir(root);
    const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    const ship = ai.decision("ship", {
      onUncertain: "abstain",
      model: "typesafe/jev-1.13.0",
      autonomy: { maxError: 0.05, audit: 0 },
      evals: join(root, "ship.jsonl"),
      ask: { team: question },
    });
    gate.policy("ops", (ctx) => ctx.operator.id === "reviewer");
    const triage = ai.decision("triage", {
      review: "ops",
      model: "typesafe/jev-1.13.0",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const seed = Array.from({ length: 60 }, () =>
      JSON.stringify({ input: { ticket: "1" }, expect: { team: "technical" } }),
    ).join("\n");
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
        },
      },
    } as unknown as Manifest;
    const code = await runOkeCertify({
      root,
      manifest,
      evaluate: async () => providerBody(),
    });
    expect(code).toBe(0);

    setDecisionProvider(async () => providerBody());
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const consoleState = { journalStore: store, manifest } as ConsoleState;
    const resolve = decisionConsoleBindings(consoleState).find(
      (binding) => binding.flow.name === "console.decisions.resolve",
    );
    if (!resolve) throw new Error("expected the console resolve route");
    const work = flow("work", {
      durable: true,
      effects: { decides: ["ship", "triage"] },
      do: async (input: { which: "ship" | "triage" }, fx) =>
        fx.decide(input.which === "ship" ? ship : triage, { ticket: "1" }),
    });

    const locked = oke({
      name: "decide-e2e",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest,
      fx: { operator: { id: "reviewer" } },
      gate: { unguardedHttp: "allow" },
      elements: { journal: { store, instanceId: "e2e", leaseMs: 30_000, driverId: "memory" } },
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
    if (!step || step.kind !== "step") throw new Error("expected a parked review");
    const unauthenticated = await locked.fetch(
      new Request("http://localhost/console/decisions/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: step.name.slice("ai-decision:".length),
          values: { team: "billing" },
        }),
      }),
    );
    expect(unauthenticated.status === 401 || unauthenticated.status === 403).toBe(true);
    const review = await resolveDecisionReview(
      store,
      step.name.slice("ai-decision:".length),
      { values: { team: "billing" }, reviewer: "reviewer", tenantId: null },
      () => Date.now(),
    );
    expect(review).toEqual({ ok: true });
    const session = await createJournal({ store, now: () => Date.now() }).resume(run.id);
    const resumed = createFx({
      flow: "work",
      effects: { decides: ["triage"] },
      journal: session,
      runId: session.runId,
      durable: true,
      now: () => Date.now(),
    });
    const output = (await resumed.decide(triage, { ticket: "1" })) as {
      team: string;
      $: { team: { how: string } };
    };
    expect(output.team).toBe("billing");
    expect(output.$.team.how).toBe("reviewed");
    await locked.bootResult?.close();

    persistDecisionDrift(true);
    closeDecisionLabelStore();
    resetDecisionCertificates();
    const restarted = oke({
      name: "decide-e2e-2",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest,
      gate: { unguardedHttp: "allow" },
    });
    await restarted.boot({ env: "test" });
    expect(decisionDriftSuspended()).toBe(true);
    expect(loadDecisionLabels("triage").length).toBeGreaterThan(0);
    await restarted.bootResult?.close();
    persistDecisionDrift(false);
    setDecisionDrift(false);

    const disk = (await Bun.file(join(root, "oke-decisions.lock.json")).json()) as {
      decisions: { ship: unknown };
    };
    const promoted = await promoteDecision({
      name: "triage",
      origin: "http://127.0.0.1:6530",
      lockPath: join(root, "oke-decisions.lock.json"),
      fetcher: async () => new Response(JSON.stringify(disk.decisions.ship), { status: 200 }),
    });
    expect(promoted.decisions.ship).toBeDefined();
    expect(promoted.decisions.triage).toBeDefined();
    closeDecisionLabelStore();
    resetDecisionCertificates();
    const after = oke({
      name: "decide-e2e-3",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      manifest,
      gate: { unguardedHttp: "allow" },
    });
    await after.boot({ env: "test" });
    const fx = createFx({
      flow: "work",
      effects: { decides: ["triage"] },
      now: () => Date.now(),
    });
    const next = (await fx.decide(triage, { ticket: "1" })) as {
      team: string;
      $: { team: { how: string } };
    };
    expect(next.$.team.how).toBe("auto");
    await after.bootResult?.close();
  });
});
