/**
 * Build a decision certificate from a seed JSONL file.
 * `{ id?, input, expect: { <question>: value }, locale? }`.
 */

import { createHash } from "node:crypto";
import type { DecisionCertSlice, DecisionLockEntry } from "./certificate.ts";

/** One seed row. */
export interface DecisionSeedCase {
  readonly id?: string;
  readonly input: unknown;
  readonly expect: Readonly<Record<string, unknown>>;
  readonly locale?: string;
}

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

/**
 * Certificate from a seed file. Each question and locale gets one slice.
 * The hash covers the expected labels. The threshold is `1` until a
 * Learn-then-Test result is written into the lockfile by promote.
 *
 * @param options - Decision name, pinned model, risk, and JSONL
 */
export function certifySeed(options: {
  readonly name: string;
  readonly model: string;
  readonly maxError: number;
  readonly jsonl: string;
}): DecisionLockEntry {
  const cases = parseDecisionSeed(options.jsonl);
  const questions: Record<string, Record<string, DecisionCertSlice>> = {};
  const seen = new Map<string, string[]>();
  for (const row of cases) {
    const locale = row.locale ?? "";
    for (const [question, value] of Object.entries(row.expect)) {
      const key = `${question}\0${locale}`;
      const list = seen.get(key) ?? [];
      list.push(JSON.stringify(value));
      seen.set(key, list);
    }
  }
  for (const [key, values] of seen) {
    const split = key.indexOf("\0");
    const question = key.slice(0, split);
    const locale = key.slice(split + 1);
    const hash = createHash("sha256").update(values.join("\n")).digest("hex");
    const slice: DecisionCertSlice = {
      hash,
      calibrator: { kind: "temperature", t: 1 },
      threshold: 1,
      metrics: { labels: values.length, maxError: options.maxError },
    };
    const bucket = questions[question] ?? {};
    bucket[locale] = slice;
    questions[question] = bucket;
  }
  void options.name;
  return { model: options.model, questions };
}
