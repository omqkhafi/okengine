/**
 * Labels and the drift flag survive a reopened store.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionDriftSuspended, setDecisionDrift } from "./certificate.ts";
import {
  auditDriftExceeded,
  closeDecisionLabelStore,
  loadDecisionLabels,
  openDecisionLabelStore,
  persistDecisionDrift,
  persistDecisionLabel,
} from "./labels.ts";

afterEach(() => {
  closeDecisionLabelStore();
  setDecisionDrift(false);
});

describe("decision labels", () => {
  test("labels and the suspension flag survive reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-labels-"));
    openDecisionLabelStore(root, setDecisionDrift);
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
    });
    persistDecisionDrift(true);
    closeDecisionLabelStore();
    setDecisionDrift(false);
    openDecisionLabelStore(root, setDecisionDrift);
    expect(loadDecisionLabels("triage", "acme")).toHaveLength(1);
    expect(loadDecisionLabels("triage", "other")).toHaveLength(0);
    expect(loadDecisionLabels("triage")).toHaveLength(1);
    expect(decisionDriftSuspended()).toBe(true);
  });

  test("audit drift is a one-sided binomial against maxError", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-drift-"));
    openDecisionLabelStore(root, setDecisionDrift);
    for (let i = 0; i < 30; i++) {
      persistDecisionLabel({
        decision: "triage",
        question: "team",
        value: "billing",
        propensity: 0.1,
        reviewer: "audit",
        loss: 1,
        score: 0.9,
      });
    }
    expect(auditDriftExceeded(0.05)).toBe(true);
  });
});
