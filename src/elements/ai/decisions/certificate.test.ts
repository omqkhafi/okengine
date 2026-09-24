/**
 * Certificates: Learn-then-Test, non-auto paths, and promote.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, resetAiDecls } from "../../ai.ts";
import {
  decisionDriftSuspended,
  learnThenTest,
  questionHash,
  resetDecisionCertificates,
  setDecisionDrift,
  setDecisionLock,
} from "./certificate.ts";
import { promoteDecision } from "../../../cli/decide.ts";
import { createFx } from "../../../kernel/fx.ts";
import { resetDecisionProvider, setDecisionProvider } from "../../../kernel/fx-decide.ts";

afterEach(() => {
  resetAiDecls();
  resetDecisionCertificates();
  resetDecisionProvider();
});

function answer() {
  setDecisionProvider(async () => ({
    model: "typesafe/jev-1.13.0",
    answers: {
      team: {
        type: "choice",
        probabilities: { billing: 0.08, technical: 0.9, none_of_these: 0.02 },
      },
    },
    usage: {},
  }));
}

async function run(
  lock: boolean,
  extra?: {
    readonly locale?: boolean;
    readonly drift?: boolean;
    readonly mismatch?: boolean;
    readonly stale?: boolean;
  },
) {
  const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
  const decl = ai.decision("triage", {
    onUncertain: "abstain",
    autonomy: { maxError: 0.05, audit: 0 },
    ...(extra?.locale ? { locale: () => "ar" } : {}),
    ask: { team: question },
  });
  if (lock) {
    setDecisionLock({
      decisions: {
        triage: {
          model: extra?.mismatch ? "other" : "typesafe/jev-1.13.0",
          questions: {
            team: {
              "": {
                hash: extra?.stale ? "nope" : questionHash(question),
                calibrator: { kind: "temperature" as const, t: 1 },
                threshold: 0.5,
              },
            },
          },
        },
      },
    });
  }
  if (extra?.drift) setDecisionDrift(true);
  const fx = createFx({ flow: "run", effects: { decides: ["triage"] }, now: () => 1 });
  return (await fx.decide(decl, {})) as { team: string | null; $: { team: { how: string } } };
}

describe("decision certificates", () => {
  test("Learn-then-Test keeps the safe threshold", () => {
    const rows = [
      { score: 0.9, loss: 0 },
      { score: 0.9, loss: 0 },
      { score: 0.9, loss: 0 },
      { score: 0.9, loss: 0 },
      { score: 0.2, loss: 1 },
      { score: 0.2, loss: 1 },
    ];
    expect(learnThenTest(rows, 0.7)).toBe(0.9);
  });

  test("missing lock, stale hash, version mismatch, locale, and drift abstain", async () => {
    answer();
    expect((await run(false)).$.team.how).toBe("abstained");
    resetAiDecls();
    expect((await run(true, { stale: true })).team).toBeNull();
    resetAiDecls();
    expect((await run(true, { mismatch: true })).team).toBeNull();
    resetAiDecls();
    expect((await run(true, { locale: true })).team).toBeNull();
    resetAiDecls();
    expect((await run(true, { drift: true })).team).toBeNull();
    expect(decisionDriftSuspended()).toBe(true);
  });

  test("promote writes the fetched candidate", async () => {
    const candidate = {
      model: "typesafe/jev-1.13.0",
      questions: {
        team: {
          "": {
            hash: "abc",
            calibrator: { kind: "temperature" as const, t: 1 },
            threshold: 0.8,
          },
        },
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "oke-decide-"));
    const lockPath = join(dir, "oke-decisions.lock.json");
    const written = await promoteDecision({
      name: "triage",
      origin: "http://127.0.0.1:6530",
      lockPath,
      current: { decisions: {} },
      fetcher: async () => new Response(JSON.stringify(candidate), { status: 200 }),
    });
    expect(written.decisions.triage).toEqual(candidate);
    const disk = JSON.parse(await readFile(lockPath, "utf8")) as { decisions: { triage: unknown } };
    expect(disk.decisions.triage).toEqual(candidate);
  });
});
