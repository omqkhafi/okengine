/**
 * Certificates: Learn-then-Test, non-auto paths, and promote.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, resetAiDecls } from "../../ai.ts";
import {
  binomialCdf,
  calibrateBoolean,
  decisionDriftSuspended,
  learnThenTest,
  loadDecisionLockfile,
  questionHash,
  resetDecisionCertificates,
  setDecisionDrift,
  setDecisionLock,
} from "./certificate.ts";
import { certifyLabels, certifySeed } from "./certify.ts";
import { runOkeCertify } from "../../../cli/eval.ts";
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
  test("Learn-then-Test certifies only a low error rate, at the loosest passing threshold", () => {
    expect(learnThenTest([{ score: 0.99, loss: 0 }], 0.05)).toBeNull();
    expect(learnThenTest([{ score: 0.99, loss: 1 }], 0.05)).toBeNull();
    const forty = Array.from({ length: 40 }, (_, i) => ({
      score: 0.99,
      loss: i < 3 ? 1 : 0,
    }));
    expect(learnThenTest(forty, 0.05)).toBeNull();
    const noisy = Array.from({ length: 2000 }, (_, i) => ({
      score: 0.99,
      loss: i < 150 ? 1 : 0,
    }));
    expect(learnThenTest(noisy, 0.05)).toBeNull();
    const correct = Array.from({ length: 500 }, (_, i) => ({
      score: 0.5 + (i % 50) / 100,
      loss: 0,
    }));
    expect(learnThenTest(correct, 0.05)).toBe(0.5);
  });

  test("binomial cdf is zero below zero and stable at n = 20000", () => {
    expect(binomialCdf(-1, 10, 0.5)).toBe(0);
    expect(Number.isFinite(binomialCdf(0, 20000, 0.5))).toBe(true);
    expect(binomialCdf(20000, 20000, 0.5)).toBe(1);
    expect(binomialCdf(10000, 20000, 0.5)).toBeGreaterThan(0.4);
    expect(binomialCdf(10000, 20000, 0.5)).toBeLessThan(0.6);
  });

  test("beta calibration with a = b = 1 and c = 0 is the identity", () => {
    const calibrator = { kind: "beta" as const, a: 1, b: 1, c: 0 };
    expect(calibrateBoolean(0.2, calibrator)).toBeCloseTo(0.2, 6);
    expect(calibrateBoolean(0.8, calibrator)).toBeCloseTo(0.8, 6);
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
    await Bun.write(lockPath, `${JSON.stringify({ decisions: { other: candidate } })}\n`);
    const merged = await promoteDecision({
      name: "triage",
      origin: "http://127.0.0.1:6530",
      lockPath,
      fetcher: async () => new Response(JSON.stringify(candidate), { status: 200 }),
    });
    expect(merged.decisions.other).toEqual(candidate);
    expect(merged.decisions.triage).toEqual(candidate);
    expect(await loadDecisionLockfile(dir)).toEqual(merged);
  });

  test("certify fits a threshold from the provider and hashes the question", async () => {
    const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    const decl = ai.decision("triage", {
      onUncertain: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      evals: "seed.jsonl",
      ask: { team: question },
    });
    const seed = Array.from({ length: 160 }, () =>
      JSON.stringify({
        input: { ticket: "1" },
        expect: { team: "technical" },
      }),
    ).join("\n");
    const entry = await certifySeed({
      model: "typesafe/jev-1.13.0",
      maxError: 0.05,
      jsonl: seed,
      ask: decl.ask,
      evaluate: async () => ({
        model: "typesafe/jev-1.13.0",
        answers: {
          team: {
            type: "choice",
            probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
          },
        },
        usage: {},
      }),
    });
    expect(entry.questions.team?.[""]?.hash).toBe(questionHash(question));
    expect(entry.questions.team?.[""]?.threshold).toBeGreaterThan(0);
    const dir = await mkdtemp(join(tmpdir(), "oke-cert-"));
    const seedPath = join(dir, "seed.jsonl");
    await Bun.write(seedPath, seed);
    const code = await runOkeCertify({
      root: dir,
      manifest: {
        oke: "1",
        app: "cert",
        ai: {
          decisions: {
            triage: {
              mode: "abstain",
              questions: ["team"],
              evals: seedPath,
              autonomy: { maxError: 0.05, audit: 0 },
            },
          },
        },
      } as never,
      evaluate: async () => ({
        model: "typesafe/jev-1.13.0",
        answers: {
          team: {
            type: "choice",
            probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
          },
        },
        usage: {},
      }),
    });
    expect(code).toBe(0);
    const loaded = await loadDecisionLockfile(dir);
    expect(loaded?.decisions.triage?.questions.team?.[""]?.hash).toBe(questionHash(question));
  });

  test("one seed row does not certify a slice", async () => {
    const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    const entry = await certifySeed({
      model: "typesafe/jev-1.13.0",
      maxError: 0.05,
      jsonl: JSON.stringify({ input: { ticket: "1" }, expect: { team: "technical" } }),
      ask: { team: question },
      evaluate: async () => ({
        model: "typesafe/jev-1.13.0",
        answers: {
          team: {
            type: "choice",
            probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
          },
        },
        usage: {},
      }),
    });
    expect(entry.questions.team).toBeUndefined();
  });

  test("choice and score labels certify from the stored distribution", () => {
    const choice = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    const score = ai.score("how sure", ["low", "high"]);
    const labels = Array.from({ length: 160 }, () => [
      {
        decision: "triage",
        question: "team",
        value: "technical",
        propensity: 1,
        reviewer: "a",
        model: "typesafe/jev-1.13.0",
        raw: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
      },
      {
        decision: "triage",
        question: "rank",
        value: "high",
        propensity: 1,
        reviewer: "a",
        model: "typesafe/jev-1.13.0",
        raw: { low: 0.08, high: 0.92 },
      },
    ]).flat();
    const entry = certifyLabels({
      model: "typesafe/jev-1.13.0",
      maxError: 0.05,
      ask: { team: choice, rank: score },
      labels,
    });
    expect(entry.questions.team?.[""]?.threshold).toBeGreaterThan(0);
    expect(entry.questions.rank?.[""]?.threshold).toBeGreaterThan(0);
  });
});
