/**
 * `fx.decide` — one provider request, journaled. Loaded with `lazyRequire`.
 */

import { aiDecisionRegistry } from "./element-registries.ts";
import type { AiDecisionDecl, AiDecisionQuestion } from "../elements/ai/declare.ts";
import {
  DecisionOutageError,
  type DecisionResponse,
  type WireQuestion,
} from "../elements/ai/decisions/provider.ts";
import {
  createOpenRouterDecisionProvider,
  OPENROUTER_JEV_MODEL,
} from "../elements/ai/decisions/openrouter.ts";
import {
  createTypesafeDecisionProvider,
  TYPESAFE_JEV_MODEL,
} from "../elements/ai/decisions/typesafe.ts";
import {
  applyTemperature,
  calibrateBoolean,
  decisionDriftSuspended,
  getDecisionLock,
  questionHash,
  recordDecisionLabel,
  type DecisionCertSlice,
  type DecisionUncertainty,
} from "../elements/ai/decisions/certificate.ts";
import {
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
  type JournalRun,
  type JournalSession,
  type JournalStore,
} from "./journal.ts";
import { leaseRetryAfterSeconds } from "../elements/ai/approval.ts";

/** Capability gate used by {@link runFxDecide}. */
export type DecideGated = (
  kind: "decide",
  resource: string,
  body: () => Promise<unknown>,
) => Promise<unknown>;

/** Inputs for one `fx.decide` call. */
export interface FxDecideInput {
  readonly gated: DecideGated;
  readonly journal?: JournalSession;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly runId?: string;
  readonly decision: { readonly name: string };
  readonly input: unknown;
}

/** How the value was produced. Audit is a flag, not a how. */
export type DecisionHow = "auto" | "reviewed" | "abstained";

/** Pending or resolved review stored on the journal step. */
export interface DecisionReviewRecord {
  readonly status: "pending" | "reviewed";
  readonly requestedAt: number;
  readonly tenant: string | null;
  readonly locale?: string;
  readonly propensity: number;
  readonly labelOnly: boolean;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly reviewer?: string;
  readonly reason?: DecisionUncertainty;
}

/** Result of {@link resolveDecisionReview}. */
export type DecisionReviewResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 404 }
  | { readonly ok: false; readonly status: 409; readonly reason: "resolved" }
  | {
      readonly ok: false;
      readonly status: 409;
      readonly reason: "lease";
      readonly retryAfterSeconds: number;
    };

type ProviderFn = (
  decl: AiDecisionDecl,
  input: unknown,
  signal: AbortSignal,
) => Promise<DecisionResponse>;

let providerOverride: ProviderFn | undefined;
let providerCalls = 0;

/**
 * Replace the provider. Tests use this so no key is required.
 *
 * @param fn - One-request evaluator, or undefined to use HTTP
 */
export function setDecisionProvider(fn: ProviderFn | undefined): void {
  providerOverride = fn;
}

/**
 * How many provider calls this process has made since the last reset.
 */
export function decisionProviderCalls(): number {
  return providerCalls;
}

/**
 * Clear the provider override and the call counter.
 */
export function resetDecisionProvider(): void {
  providerOverride = undefined;
  providerCalls = 0;
}

/**
 * Journal step prefix. Distinct from `ai-approval:`.
 *
 * @param id - Review id
 * @param labelOnly - Audit queue, which does not park the caller
 */
export function decisionStepName(id: string, labelOnly = false): string {
  return labelOnly ? `ai-decision-label:${id}` : `ai-decision:${id}`;
}

/**
 * Run one declared decision.
 *
 * @param options - Gate, journal, and the decision handle
 */
export async function runFxDecide(options: FxDecideInput): Promise<unknown> {
  const name = options.decision.name;
  return options.gated("decide", name, () => executeDecide(options, name));
}

async function executeDecide(options: FxDecideInput, name: string): Promise<unknown> {
  const decl = aiDecisionRegistry.find((item) => item.name === name);
  if (!decl) throw new Error(`fx.decide: unknown decision "${name}"`);
  const recorded = options.journal
    ? await options.journal.effect("decide-provider", name, () => callAndDraw(decl, options))
    : await callAndDraw(decl, options);
  const view = project(decl, options.input, recorded);
  if (view.auto) {
    if (recorded.audited && options.journal) {
      const id = reviewId(options.journal.runId, name);
      await options.journal.step(decisionStepName(id, true), () =>
        pendingRecord(options, view, true),
      );
    }
    return view.result;
  }
  if (decl.mode === "abstain") return abstain(view);
  if (!options.journal) {
    throw new Error(`fx.decide: "${name}" review requires a durable journal`);
  }
  const id = reviewId(options.journal.runId, name);
  const step = decisionStepName(id, false);
  const stored = (await options.journal.step(step, () =>
    pendingRecord(options, view, false),
  )) as DecisionReviewRecord;
  if (stored.status === "pending") {
    await options.journal.sleep(step, "876000h", () => 876000 * 60 * 60 * 1000);
  }
  const resolved = (await options.journal.step(step, () => stored)) as DecisionReviewRecord;
  return reviewed(view, resolved.values ?? {});
}

interface RecordedCall {
  readonly response?: DecisionResponse;
  readonly outage: boolean;
  readonly audited: boolean;
  readonly propensity: number;
}

async function callAndDraw(decl: AiDecisionDecl, options: FxDecideInput): Promise<RecordedCall> {
  const rate = decl.autonomy?.audit ?? 0;
  const seed = `${options.runId ?? options.journal?.runId ?? "run"}:${decl.name}`;
  const draw = auditDraw(seed, rate);
  try {
    providerCalls += 1;
    const response = await callProvider(decl, options.input, options.signal);
    return { response, outage: false, audited: draw.audited, propensity: draw.propensity };
  } catch (err) {
    if (err instanceof DecisionOutageError) {
      return { outage: true, audited: false, propensity: draw.propensity };
    }
    throw err;
  }
}

async function callProvider(
  decl: AiDecisionDecl,
  input: unknown,
  signal: AbortSignal,
): Promise<DecisionResponse> {
  if (providerOverride) return providerOverride(decl, input, signal);
  const model =
    decl.model ?? (decl.driverId === "typesafe" ? TYPESAFE_JEV_MODEL : OPENROUTER_JEV_MODEL);
  const keyName = decl.driverId === "typesafe" ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = process.env[keyName];
  if (!apiKey) throw new DecisionOutageError(`${keyName} is not set`);
  const provider =
    decl.driverId === "typesafe"
      ? createTypesafeDecisionProvider(apiKey)
      : createOpenRouterDecisionProvider(apiKey);
  return provider.evaluate({
    model,
    state: input,
    questions: wireQuestions(decl),
    signal,
  });
}

function wireQuestions(decl: AiDecisionDecl): Record<string, WireQuestion> {
  const questions: Record<string, WireQuestion> = {};
  for (const [id, question] of Object.entries(decl.ask)) {
    questions[id] = wireQuestion(question);
  }
  return questions;
}

function wireQuestion(question: AiDecisionQuestion): WireQuestion {
  if (question.kind === "choice") {
    return {
      type: "choice",
      instructions: question.instructions,
      criteria: { ...question.options, none_of_these: null },
    };
  }
  if (question.kind === "score") {
    return { type: "score", instructions: question.instructions, criteria: question.levels };
  }
  return {
    type: "noul",
    instructions: question.instructions,
    ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
  };
}

interface Projected {
  readonly auto: boolean;
  readonly result: Record<string, unknown>;
  readonly reason?: DecisionUncertainty;
  readonly propensity: number;
  readonly locale?: string;
}

function project(decl: AiDecisionDecl, input: unknown, recorded: RecordedCall): Projected {
  const locale = decl.locale?.(input);
  const dollar: Record<string, unknown> = {
    meta: {
      model: recorded.response?.model,
      provider: recorded.response?.provider ?? decl.driverId,
      usage: recorded.response?.usage ?? {},
    },
  };
  const values: Record<string, unknown> = {};
  let auto = !recorded.outage && !decisionDriftSuspended();
  let reason: DecisionUncertainty | undefined = recorded.outage
    ? "outage"
    : decisionDriftSuspended()
      ? "drift"
      : undefined;
  const lock = getDecisionLock()?.decisions[decl.name];
  if (!recorded.outage && !decisionDriftSuspended()) {
    if (!lock || !decl.autonomy) {
      auto = false;
      reason = "missing-lock";
    } else if (lock.model !== recorded.response?.model) {
      auto = false;
      reason = "version-mismatch";
    }
  }
  for (const [id, question] of Object.entries(decl.ask)) {
    const slice = sliceFor(lock, id, locale);
    const answer = recorded.response?.answers[id];
    const calibrated = calibrateAnswer(question, answer, slice);
    let how: DecisionHow = "auto";
    let questionAuto = auto && slice !== undefined && calibrated.p >= (slice?.threshold ?? 1);
    if (slice === undefined && !reason) {
      questionAuto = false;
      reason = locale ? "uncertified-locale" : "missing-lock";
    } else if (slice && questionHash(question) !== slice.hash) {
      questionAuto = false;
      reason = "stale-hash";
    } else if (slice && calibrated.p < slice.threshold) {
      questionAuto = false;
      reason = reason ?? "low-confidence";
    }
    if (!questionAuto) {
      auto = false;
      how = decl.mode === "abstain" ? "abstained" : "auto";
    }
    values[id] = questionAuto
      ? calibrated.value
      : decl.mode === "abstain"
        ? null
        : calibrated.value;
    dollar[id] = {
      how: questionAuto ? "auto" : decl.mode === "abstain" ? "abstained" : "auto",
      p: calibrated.p,
      raw: calibrated.raw,
      ...(recorded.audited && questionAuto ? { audited: true } : {}),
    };
    void how;
  }
  if (!auto && decl.mode === "abstain") {
    for (const id of Object.keys(decl.ask)) {
      values[id] = null;
      const slot = dollar[id] as Record<string, unknown>;
      slot.how = "abstained";
    }
  }
  return {
    auto,
    result: { ...values, $: dollar },
    ...(reason !== undefined ? { reason } : {}),
    propensity: recorded.propensity,
    ...(locale !== undefined ? { locale } : {}),
  };
}

function sliceFor(
  lock:
    | { readonly questions: Readonly<Record<string, Readonly<Record<string, DecisionCertSlice>>>> }
    | undefined,
  question: string,
  locale: string | undefined,
): DecisionCertSlice | undefined {
  if (!lock) return undefined;
  const slices = lock.questions[question];
  if (!slices) return undefined;
  return slices[locale ?? ""];
}

function calibrateAnswer(
  question: AiDecisionQuestion,
  answer: unknown,
  slice: DecisionCertSlice | undefined,
): { readonly value: unknown; readonly p: number; readonly raw: unknown } {
  const record = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  if (question.kind === "boolean") {
    const noul = typeof record.noul === "number" ? record.noul : 0;
    const calibrator =
      slice?.calibrator.kind === "platt" || slice?.calibrator.kind === "beta"
        ? slice.calibrator
        : { kind: "platt" as const, a: 1, b: 0 };
    const p = calibrateBoolean(noul, calibrator);
    return { value: noul >= 0.5, p, raw: { noul } };
  }
  const probs = probabilityList(question, record.probabilities);
  const t = slice?.calibrator.kind === "temperature" ? slice.calibrator.t : 1;
  const scaled = applyTemperature(probs.values, t);
  let best = 0;
  for (let i = 1; i < scaled.length; i++) {
    if ((scaled[i] ?? 0) > (scaled[best] ?? 0)) best = i;
  }
  return {
    value: probs.keys[best],
    p: scaled[best] ?? 0,
    raw: record.probabilities ?? probs.values,
  };
}

function probabilityList(
  question: AiDecisionQuestion,
  raw: unknown,
): { readonly keys: string[]; readonly values: number[] } {
  const keys =
    question.kind === "choice"
      ? [...Object.keys(question.options), "none_of_these"]
      : question.kind === "score"
        ? [...question.levels]
        : [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    return {
      keys,
      values: keys.map((key) => (typeof record[key] === "number" ? record[key] : 0)),
    };
  }
  if (Array.isArray(raw)) {
    return { keys, values: keys.map((_, i) => (typeof raw[i] === "number" ? raw[i] : 0)) };
  }
  return { keys, values: keys.map(() => 0) };
}

function abstain(view: Projected): Record<string, unknown> {
  return view.result;
}

function reviewed(
  view: Projected,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const dollar = { ...(view.result.$ as Record<string, unknown>) };
  const next: Record<string, unknown> = { $: dollar };
  for (const [id, value] of Object.entries(values)) {
    next[id] = value;
    const slot = dollar[id];
    if (slot && typeof slot === "object") {
      dollar[id] = { ...(slot as Record<string, unknown>), how: "reviewed" };
    }
  }
  for (const [id, value] of Object.entries(view.result)) {
    if (id === "$" || id in next) continue;
    next[id] = value;
  }
  return next;
}

function pendingRecord(
  options: FxDecideInput,
  view: Projected,
  labelOnly: boolean,
): DecisionReviewRecord {
  return {
    status: "pending",
    requestedAt: options.now(),
    tenant: null,
    ...(view.locale !== undefined ? { locale: view.locale } : {}),
    propensity: view.propensity,
    labelOnly,
    ...(view.reason !== undefined ? { reason: view.reason } : {}),
  };
}

function reviewId(runId: string, name: string): string {
  return Buffer.from(`${runId}.${name}`, "utf8").toString("base64url");
}

function auditDraw(
  seed: string,
  rate: number,
): { readonly audited: boolean; readonly propensity: number } {
  if (rate <= 0) return { audited: false, propensity: 0 };
  const digest = new Uint32Array(1);
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  digest[0] = hash >>> 0;
  const unit = (digest[0] ?? 0) / 0x1_0000_0000;
  return { audited: unit < rate, propensity: rate };
}

/**
 * Read one decision review from the journal.
 *
 * @param store - Durable journal
 * @param id - Review id
 * @param labelOnly - Audit queue row
 */
export async function readDecisionReview(
  store: JournalStore,
  id: string,
  labelOnly = false,
): Promise<DecisionReviewRecord | undefined> {
  const parsed = parseReviewId(id);
  if (!parsed) return undefined;
  const run = await store.get(parsed.runId);
  if (!run) return undefined;
  const name = decisionStepName(id, labelOnly);
  const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
  if (!entry || entry.kind !== "step") return undefined;
  return entry.value as DecisionReviewRecord;
}

/**
 * Resolve a parked decision or an audit label row.
 * A lost lease retries. A finished review is a conflict.
 * The label is written here, including audit reviews.
 *
 * @param store - Durable journal
 * @param id - Review id
 * @param input - Reviewer value
 * @param now - Clock
 * @param labelOnly - Audit queue
 */
export async function resolveDecisionReview(
  store: JournalStore,
  id: string,
  input: { readonly values: Readonly<Record<string, unknown>>; readonly reviewer: string },
  now: () => number = Date.now,
  labelOnly = false,
): Promise<DecisionReviewResult> {
  const parsed = parseReviewId(id);
  if (!parsed || typeof store.acquireLease !== "function") return { ok: false, status: 404 };
  const name = decisionStepName(id, labelOnly);
  const token = crypto.randomUUID();
  const at = now();
  const claimed = await store.acquireLease(parsed.runId, token, at, JOURNAL_DEFAULT_LEASE_MS);
  if (!claimed) {
    const held = await store.get(parsed.runId);
    return {
      ok: false,
      status: 409,
      reason: "lease",
      retryAfterSeconds: leaseRetryAfterSeconds(held?.leaseExpiresAt, at),
    };
  }
  try {
    const run = await store.get(parsed.runId);
    if (!run) return { ok: false, status: 404 };
    const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
    if (!entry || entry.kind !== "step") return { ok: false, status: 404 };
    const current = entry.value as DecisionReviewRecord;
    if (current.status !== "pending") return { ok: false, status: 409, reason: "resolved" };
    const next: DecisionReviewRecord = {
      ...current,
      status: "reviewed",
      values: input.values,
      reviewer: input.reviewer,
    };
    const entries: JournalEntry[] = run.entries.map((item) => {
      if (item.kind === "step" && item.name === name) return { ...item, value: next };
      if (item.kind === "sleep" && item.label === name) return { ...item, wakeAt: at };
      return item;
    });
    const updated: JournalRun = { ...run, entries, wakeAt: at };
    await store.put(updated);
    for (const [question, value] of Object.entries(input.values)) {
      recordDecisionLabel({
        decision: parsed.name,
        question,
        value,
        propensity: current.propensity,
        reviewer: input.reviewer,
        ...(current.locale !== undefined ? { locale: current.locale } : {}),
        ...(current.tenant !== null ? { tenant: current.tenant } : {}),
      });
    }
    return { ok: true };
  } finally {
    await store.releaseLease?.(parsed.runId, token);
  }
}

function parseReviewId(id: string): { readonly runId: string; readonly name: string } | undefined {
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const dot = decoded.indexOf(".");
    if (dot <= 0) return undefined;
    return { runId: decoded.slice(0, dot), name: decoded.slice(dot + 1) };
  } catch {
    return undefined;
  }
}
