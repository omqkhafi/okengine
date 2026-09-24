/**
 * Labels and the drift flag live on the journal driver.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileJournalStore, createMemoryJournalStore } from "../../../kernel/journal.ts";
import { decisionDriftSuspended, setDecisionDrift, setDecisionLock } from "./certificate.ts";
import {
  auditDriftExceeded,
  closeDecisionLabelStore,
  flushDecisionLabels,
  loadDecisionLabels,
  openDecisionLabelStore,
  persistDecisionDrift,
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
    expect(loadDecisionLabels("triage", "acme")).toHaveLength(1);
    expect(loadDecisionLabels("triage", "other")).toHaveLength(0);
    expect(loadDecisionLabels("triage")).toHaveLength(1);
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
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: 0,
        labels: loadDecisionLabels("triage"),
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
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: now - 1000,
        now,
        labels: loadDecisionLabels("triage"),
      }),
    ).toBe(true);
    expect(
      auditDriftExceeded({
        maxError: 0.05,
        model: "typesafe/jev-1.13.0",
        since: now + 1,
        now,
        labels: loadDecisionLabels("triage"),
      }),
    ).toBe(false);
  });
});
