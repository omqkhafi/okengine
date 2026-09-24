/**
 * Decision list state and pending age.
 */

import { describe, expect, test } from "bun:test";
import type { JournalRun } from "../../kernel/journal.ts";
import { projectDecisionList, projectDecisionQueue } from "./decisions.ts";
import { setDecisionDrift, setDecisionLock, resetDecisionCertificates } from "../../elements/ai/decisions/certificate.ts";
import type { Manifest } from "../../manifest/types.ts";

const manifest = {
  ai: {
    decisions: {
      triage: { mode: "review" as const, questions: ["team"] },
    },
  },
} as unknown as Manifest;

describe("decision console projection", () => {
  test("lockfile and drift set the list state", () => {
    resetDecisionCertificates();
    expect(projectDecisionList(manifest)[0]?.state).toBe("learning");
    setDecisionLock({
      decisions: {
        triage: { model: "typesafe/jev-1.13.0", questions: {} },
      },
    });
    expect(projectDecisionList(manifest)[0]?.state).toBe("certified");
    setDecisionDrift(true);
    expect(projectDecisionList(manifest)[0]?.state).toBe("suspended");
    resetDecisionCertificates();
  });

  test("queue age is now minus requestedAt", () => {
    const run = {
      id: "run",
      flow: "run",
      status: "sleeping",
      entries: [
        {
          kind: "step" as const,
          name: "ai-decision:abc",
          at: 1_000,
          value: { status: "pending", requestedAt: 1_000 },
        },
      ],
    } as JournalRun;
    const [row] = projectDecisionQueue([run], 61_000);
    expect(row?.ageMs).toBe(60_000);
    expect(row?.labelOnly).toBe(false);
  });
});
