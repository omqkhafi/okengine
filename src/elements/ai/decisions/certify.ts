/**
 * Build a decision certificate from a seed JSONL file.
 * `{ id?, input, expect: { <question>: value }, locale? }`.
 */

import type { AiDecisionQuestion } from "../declare.ts";
import { applyTemperature, learnThenTest, questionHash, type DecisionCalibrator, type DecisionCertSlice, type DecisionLabel, type DecisionLockEntry } from "./certificate.ts";
import type { DecisionResponse } from "./provider.ts";

/** One seed row. */
export interface DecisionSeedCase {
  readonly id?: string;
  readonly input: unknown;
  readonly expect: Readonly<Record<string, unknown>>;
  readonly locale?: string;
}

/** One provider call used while certifying. */
export type DecisionEvaluate = (input: unknown) => Promise<DecisionResponse>;

/**
 * Parse decision seed JSONL. Blank lines are skipped.
 *
 * @param text - File contents
 */
export function parseDecisionSeed(text: string): DecisionSeedCase[] {
  const cases: DecisionSeedCase[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as {
      id?: unknown;
      input?: unknown;
      expect?: unknown;
      locale?: unknown;
    };
    if (!row.expect || typeof row.expect !== "object" || Array.isArray(row.expect)) {
      throw new TypeError("decision seed row needs expect");
    }
    cases.push({
      ...(typeof row.id === "string" ? { id: row.id } : {}),
      input: row.input,
      expect: row.expect as Readonly<Record<string, unknown>>,
      ...(typeof row.locale === "string" ? { locale: row.locale } : {}),
    });
  }
  return cases;
}

/** One labeled probability used to fit a slice. */
interface FitRow {
  readonly probs: readonly number[];
  readonly labelIndex: number;
  readonly noul?: number;
  readonly booleanLabel?: boolean;
}

/**
 * Certificate from a seed file. Calls the provider, fits a calibrator per
 * question, and keeps a threshold only when Learn-then-Test passes.
 *
 * @param options - Decision, risk, seed, and provider
 */
export async function certifySeed(options: {
  readonly model: string;
  readonly maxError: number;
  readonly delta?: number;
  readonly jsonl: string;
  readonly ask: Readonly<Record<string, AiDecisionQuestion>>;
  readonly evaluate: DecisionEvaluate;
}): Promise<DecisionLockEntry> {
  const cases = parseDecisionSeed(options.jsonl);
  const buckets = new Map<string, FitRow[]>();
  for (const row of cases) {
    const response = await options.evaluate(row.input);
    const locale = row.locale ?? "";
    for (const [id, expected] of Object.entries(row.expect)) {
      const question = options.ask[id];
      if (!question) continue;
      const answer = response.answers[id];
      const fit = fitRow(question, answer, expected);
      if (!fit) continue;
      const key = `${id}\0${locale}`;
      const list = buckets.get(key) ?? [];
      list.push(fit);
      buckets.set(key, list);
    }
  }
  return entryFromBuckets(options.model, options.ask, buckets, options.maxError, options.delta ?? 0.1);
}

/**
 * The same certificate, built from persisted labels that already carry a score.
 *
 * @param options - Model, questions, labels, and risk
 */
export function certifyLabels(options: {
  readonly model: string;
  readonly maxError: number;
  readonly delta?: number;
  readonly ask: Readonly<Record<string, AiDecisionQuestion>>;
  readonly labels: readonly DecisionLabel[];
}): DecisionLockEntry {
  const groups = new Map<string, DecisionLabel[]>();
  for (const label of options.labels) {
    if (label.score === undefined) continue;
    const key = `${label.question}\0${label.locale ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(label);
    groups.set(key, list);
  }
  const questions: Record<string, Record<string, DecisionCertSlice>> = {};
  const model = options.labels.find((label) => label.model)?.model ?? options.model;
  const delta = options.delta ?? 0.1;
  for (const [key, rows] of groups) {
    const split = key.indexOf("\0");
    const id = key.slice(0, split);
    const locale = key.slice(split + 1);
    const question = options.ask[id];
    if (!question) continue;
    const scored = rows.map((row) => ({ score: row.score ?? 0, loss: row.loss ?? 0 }));
    const threshold = learnThenTest(scored, options.maxError, delta);
    if (threshold === null) continue;
    const bucket = questions[id] ?? {};
    bucket[locale] = {
      hash: questionHash(question),
      calibrator: question.kind === "boolean" ? { kind: "platt", a: 1, b: 0 } : { kind: "temperature", t: 1 },
      threshold,
      metrics: { labels: rows.length, maxError: options.maxError, delta },
    };
    questions[id] = bucket;
  }
  return { model, questions };
}

function entryFromBuckets(
  model: string,
  ask: Readonly<Record<string, AiDecisionQuestion>>,
  buckets: ReadonlyMap<string, readonly FitRow[]>,
  maxError: number,
  delta: number,
): DecisionLockEntry {
  const questions: Record<string, Record<string, DecisionCertSlice>> = {};
  for (const [key, rows] of buckets) {
    const split = key.indexOf("\0");
    const id = key.slice(0, split);
    const locale = key.slice(split + 1);
    const question = ask[id];
    if (!question) continue;
    const slice = sliceFromRows(question, rows, maxError, delta);
    if (!slice) continue;
    const bucket = questions[id] ?? {};
    bucket[locale] = slice;
    questions[id] = bucket;
  }
  return { model, questions };
}

function sliceFromRows(
  question: AiDecisionQuestion,
  rows: readonly FitRow[],
  maxError: number,
  delta: number,
): DecisionCertSlice | undefined {
  const calibrator = fitCalibrator(question, rows);
  const scored = rows.map((row) => scoreFit(question, row, calibrator));
  const threshold = learnThenTest(scored, maxError, delta);
  if (threshold === null) return undefined;
  const errors = scored.filter((row) => row.score >= threshold && row.loss > 0).length;
  const accepted = scored.filter((row) => row.score >= threshold).length;
  return {
    hash: questionHash(question),
    calibrator,
    threshold,
    metrics: { labels: rows.length, accepted, errors, maxError, delta },
  };
}

function fitCalibrator(question: AiDecisionQuestion, rows: readonly FitRow[]): DecisionCalibrator {
  if (question.kind === "boolean") return fitPlatt(rows);
  return { kind: "temperature", t: fitTemperature(rows) };
}

function fitTemperature(rows: readonly FitRow[]): number {
  let bestT = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= 20; step++) {
    const t = step / 10;
    let nll = 0;
    for (const row of rows) {
      const scaled = applyTemperature(row.probs, t);
      nll -= Math.log(Math.max(scaled[row.labelIndex] ?? 1e-12, 1e-12));
    }
    if (nll < best) {
      best = nll;
      bestT = t;
    }
  }
  return bestT;
}

function fitPlatt(rows: readonly FitRow[]): DecisionCalibrator {
  let best = { a: 1, b: 0, nll: Number.POSITIVE_INFINITY };
  for (let a = -2; a <= 2.01; a += 0.5) {
    for (let b = -2; b <= 2.01; b += 0.5) {
      let nll = 0;
      for (const row of rows) {
        const p = platt(row.noul ?? 0.5, a, b);
        const y = row.booleanLabel ? 1 : 0;
        nll -= y * Math.log(Math.max(p, 1e-12)) + (1 - y) * Math.log(Math.max(1 - p, 1e-12));
      }
      if (nll < best.nll) best = { a, b, nll };
    }
  }
  return { kind: "platt", a: best.a, b: best.b };
}

function platt(noul: number, a: number, b: number): number {
  const p = Math.min(1, Math.max(0, noul));
  const logit = Math.log(Math.max(p, 1e-12) / Math.max(1 - p, 1e-12));
  return 1 / (1 + Math.exp(-(a * logit + b)));
}

function scoreFit(
  question: AiDecisionQuestion,
  row: FitRow,
  calibrator: DecisionCalibrator,
): { readonly score: number; readonly loss: number } {
  if (question.kind === "boolean" && calibrator.kind !== "temperature") {
    const p = platt(row.noul ?? 0.5, calibrator.kind === "platt" ? calibrator.a : 1, calibrator.kind === "platt" ? calibrator.b : 0);
    const predicted = p >= 0.5;
    return { score: Math.max(p, 1 - p), loss: predicted === row.booleanLabel ? 0 : 1 };
  }
  const t = calibrator.kind === "temperature" ? calibrator.t : 1;
  const scaled = applyTemperature(row.probs, t);
  let best = 0;
  for (let i = 1; i < scaled.length; i++) {
    if ((scaled[i] ?? 0) > (scaled[best] ?? 0)) best = i;
  }
  return { score: scaled[best] ?? 0, loss: best === row.labelIndex ? 0 : 1 };
}

function fitRow(question: AiDecisionQuestion, answer: unknown, expected: unknown): FitRow | undefined {
  const record = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  if (question.kind === "boolean") {
    if (typeof expected !== "boolean") return undefined;
    return { probs: [], labelIndex: expected ? 1 : 0, noul: typeof record.noul === "number" ? record.noul : 0, booleanLabel: expected };
  }
  const keys = question.kind === "choice" ? [...Object.keys(question.options), "none_of_these"] : [...question.levels];
  const labelIndex = keys.indexOf(String(expected));
  if (labelIndex < 0) return undefined;
  const raw = record.probabilities;
  const probs = keys.map((key, index) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const value = (raw as Record<string, unknown>)[key];
      return typeof value === "number" ? value : 0;
    }
    return Array.isArray(raw) && typeof raw[index] === "number" ? raw[index] : 0;
  });
  return { probs, labelIndex };
}

