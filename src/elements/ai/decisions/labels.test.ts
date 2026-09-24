/**
 * Labels and the drift flag live on the journal driver.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileJournalStore, createMemoryJournalStore } from "../../../kernel/journal.ts";
import {
  DecisionLabelStoreError,
  createPostgresDecisionLabelStore,
} from "../../../kernel/decision-label-store.ts";
import { decisionDriftSuspended, setDecisionDrift, setDecisionLock } from "./certificate.ts";
import {
  auditDriftExceeded,
  closeDecisionLabelStore,
  flushDecisionLabels,
  loadDecisionLabels,
  openDecisionLabelStore,
  persistDecisionDrift,
  decisionLabelWriteFailures,
  persistDecisionLabel,
} from "./labels.ts";

afterEach(() => {
  closeDecisionLabelStore();
  setDecisionDrift(false);
  setDecisionLock(undefined);
});

describe("decision labels", () => {
  test("labels and the suspension flag survive a reopened journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-labels-"));
    const path = join(root, "journal.json");
    const first = createFileJournalStore(path);
    await openDecisionLabelStore(first, setDecisionDrift);
    persistDecisionLabel({
      decision: "triage",
      question: "team",
      value: "billing",
      propensity: 1,
      reviewer: "a",
      tenant: "acme",
      model: "jev",
      score: 0.4,
      loss: 1,
      at: 1,
    });
    persistDecisionDrift(true);
    await flushDecisionLabels();
    closeDecisionLabelStore();
    setDecisionDrift(false);
    const second = createFileJournalStore(path);
    await openDecisionLabelStore(second, setDecisionDrift);
    const saved = await loadDecisionLabels("triage", "acme");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.at).toBe(1);
    expect(await loadDecisionLabels("triage", "other")).toHaveLength(0);
    expect(await loadDecisionLabels("triage")).toHaveLength(1);
    expect(decisionDriftSuspended()).toBe(true);
  });

  test("one correct audit label never suspends", async () => {
    const journal = createMemoryJournalStore();
    await openDecisionLabelStore(journal, setDecisionDrift);
    persistDecisionLabel({
      decision: "triage",
      question: "team",
      value: "technical",
      propensity: 0.1,
      reviewer: "audit",
      model: "typesafe/jev-1.13.0",
      loss: 0,
      at: Date.now(),
    });
    await flushDecisionLabels();
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: 0,
        labels: await loadDecisionLabels("triage"),
      }),
    ).toBe(false);
  });

  test("audit drift is a one-sided binomial on the pinned model since the certificate", async () => {
    const journal = createMemoryJournalStore();
    await openDecisionLabelStore(journal, setDecisionDrift);
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      persistDecisionLabel({
        decision: "triage",
        question: "team",
        value: "billing",
        propensity: 0.1,
        reviewer: "audit",
        model: "typesafe/jev-1.13.0",
        loss: 1,
        at: now,
      });
    }
    persistDecisionLabel({
      decision: "triage",
      question: "team",
      value: "billing",
      propensity: 0.1,
      reviewer: "audit",
      model: "other-model",
      loss: 1,
      at: now,
    });
    await flushDecisionLabels();
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: now - 1000,
        now,
        labels: await loadDecisionLabels("triage"),
      }),
    ).toBe(true);
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: now + 1,
        now,
        labels: await loadDecisionLabels("triage"),
      }),
    ).toBe(false);
  });

  test("a newer certificate ignores a drift flag raised against the previous one", async () => {
    const journal = createMemoryJournalStore();
    await openDecisionLabelStore(journal, setDecisionDrift);
    persistDecisionDrift(true, 100);
    await flushDecisionLabels();
    closeDecisionLabelStore();
    setDecisionDrift(false);
    setDecisionLock({
      decisions: {
        triage: { model: "typesafe/jev-1.13.0", certifiedAt: 200, questions: {} },
      },
    });
    await openDecisionLabelStore(journal, setDecisionDrift);
    expect(decisionDriftSuspended()).toBe(false);
  });

  test("one failed insert does not drop the next write", async () => {
    const journal = createMemoryJournalStore();
    const decisions = journal.decisions;
    if (!decisions) throw new Error("expected a label store");
    let calls = 0;
    const original = decisions.insert.bind(decisions);
    decisions.insert = async (label, at) => {
      calls += 1;
      if (calls === 1) throw new Error("insert failed");
      await original(label, at);
    };
    await openDecisionLabelStore(journal, setDecisionDrift);
    persistDecisionLabel({
      decision: "triage",
      question: "team",
      value: "a",
      propensity: 1,
      reviewer: "a",
    });
    persistDecisionLabel({
      decision: "triage",
      question: "team",
      value: "b",
      propensity: 1,
      reviewer: "a",
    });
    await flushDecisionLabels();
    const rows = await loadDecisionLabels("triage");
    expect(rows.map((row) => row.value)).toEqual(["b"]);
    expect(decisionLabelWriteFailures().map((event) => event.message)).toEqual(["insert failed"]);
  });

  test("a postgres label store throws when init fails", async () => {
    const sql = {
      async query(): Promise<Record<string, unknown>[]> {
        throw new Error("query failed");
      },
      async exec(): Promise<{ changes: number }> {
        throw new Error("exec failed");
      },
    };
    await expect(createPostgresDecisionLabelStore(sql)).rejects.toBeInstanceOf(
      DecisionLabelStoreError,
    );
  });

  test("postgres null tenant matches, and an older drift table gains certified_at", async () => {
    const { connectPglite } = await import("../../../drivers/pglite.ts");
    const db = await connectPglite({ url: "memory://decision-labels" });
    try {
      await db.exec(`CREATE TABLE oke_decision_drift (
        id INTEGER PRIMARY KEY,
        suspended INTEGER NOT NULL
      )`);
      await db.exec(`INSERT INTO oke_decision_drift (id, suspended) VALUES (1, 1)`);
      const store = await createPostgresDecisionLabelStore(db);
      await store.insert(
        {
          decision: "triage",
          question: "team",
          value: "billing",
          propensity: 1,
          reviewer: "a",
        },
        1,
      );
      await store.insert(
        {
          decision: "triage",
          question: "team",
          value: "technical",
          propensity: 1,
          reviewer: "a",
          tenant: "acme",
        },
        2,
      );
      const unlabeled = await store.list("triage", null);
      const acme = await store.list("triage", "acme");
      expect(unlabeled.map((row) => row.value)).toEqual(["billing"]);
      expect(acme.map((row) => row.value)).toEqual(["technical"]);
      expect(await store.drift()).toEqual({ suspended: true, certifiedAt: 0 });
    } finally {
      await db.close();
    }
  });
});
