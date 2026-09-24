/**
 * `fx.decide` — one provider request, journaled. Loaded with `lazyRequire`.
 */

import { aiDecisionRegistry, gateRegistry } from "./element-registries.ts";
import type { GatePolicyContext } from "../elements/gate/declare.ts";
import type { AiDecisionDecl, AiDecisionQuestion } from "../elements/ai/declare.ts";
import {
  DecisionConfigError,
  DecisionOutageError,
  type DecisionResponse,
  type WireQuestion,
} from "../elements/ai/decisions/provider.ts";
import { parseDurationMs } from "../elements/clock/duration.ts";
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
import { flushDecisionLabels, persistDecisionLabel } from "../elements/ai/decisions/labels.ts";
import {
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
  type JournalRun,
  type JournalSession,
  type JournalStore,
} from "./journal.ts";
import { leaseRetryAfterSeconds } from "../elements/ai/approval.ts";

/** Retry-After above this is an outage, not a wait. */
export const DECISION_RETRY_CAP_SECONDS = 60;

let decisionAllow:
  | ((names: readonly string[], ctx: GatePolicyContext) => Promise<boolean>)
  | undefined;

/**
 * Install the booted gate runtime. Resolve uses the same `allow` path as approvals.
 *
 * @param allow - `gates.allow`, or undefined in tests that build a runtime from the registry
 */
export function setDecisionGateAllow(
  allow: ((names: readonly string[], ctx: GatePolicyContext) => Promise<boolean>) | undefined,
): void {
  decisionAllow = allow;
}

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
  /** Tenant of the calling flow. Stamped on pending reviews. */
  readonly tenantId?: string | null;
  /**
   * Resolve a secret through the flow's secret capability.
   * Missing or empty is a config error, not an outage.
   */
  readonly getSecret?: (name: string) => Promise<string | undefined>;
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
  /** Question ids that are not auto. Resolve must answer each of them. */
  readonly open?: readonly string[];
  readonly model?: string;
  readonly scores?: Readonly<Record<string, number>>;
  readonly raws?: Readonly<Record<string, unknown>>;
  readonly modelValues?: Readonly<Record<string, unknown>>;
}

/** Result of {@link resolveDecisionReview}. */
export type DecisionReviewResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 404 }
  | { readonly ok: false; readonly status: 403 }
  | { readonly ok: false; readonly status: 422 }
  | { readonly ok: false; readonly status: 503; readonly reason: "outage" }
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
  const ordinal = decideOrdinal(options.journal, name);
  const slot = `${name}#${ordinal}`;
  const recorded = options.journal
    ? await options.journal.effect("decide-provider", slot, () => callAndDraw(decl, options, ordinal))
    : await callAndDraw(decl, options, ordinal);
  const view = options.journal
    ? ((await options.journal.effect("decide-view", slot, () =>
        project(decl, options.input, recorded),
      )) as JournaledView)
    : project(decl, options.input, recorded);
  if (view.auto) {
    if (view.audited && options.journal) {
      const id = reviewId(options.journal.runId, ordinal, name);
      await options.journal.step(decisionStepName(id, true), () =>
        pendingRecord(options, view, true),
      );
    }
    return materialize(view);
  }
  if (decl.mode === "abstain") return materialize(view);
  if (!options.journal) {
    throw new Error(`fx.decide: "${name}" review requires a durable journal`);
  }
  const id = reviewId(options.journal.runId, ordinal, name);
  const step = decisionStepName(id, false);
  const stored = (await options.journal.step(step, () =>
    pendingRecord(options, view, false),
  )) as DecisionReviewRecord;
  if (stored.status === "pending") {
    await options.journal.sleep(step, "876000h", () => 876000 * 60 * 60 * 1000);
  }
  const resolved = readStepRecord(options.journal, step) ?? stored;
  return reviewed(view, resolved.values ?? {});
}

/** Completed outer `decide` effects for this name. The current call is not stored yet. */
function decideOrdinal(journal: JournalSession | undefined, name: string): number {
  if (!journal) return 0;
  return journal.run.entries.filter(
    (entry) => entry.kind === "effect" && entry.effectKind === "decide" && entry.resource === name,
  ).length;
}

function readStepRecord(journal: JournalSession, step: string): DecisionReviewRecord | undefined {
  const entry = journal.run.entries.find((item) => item.kind === "step" && item.name === step);
  if (!entry || entry.kind !== "step") return undefined;
  return entry.value as DecisionReviewRecord;
}

interface RecordedCall {
  readonly response?: DecisionResponse;
  readonly outage: boolean;
  readonly audited: boolean;
  readonly propensity: number;
}

async function callAndDraw(
  decl: AiDecisionDecl,
  options: FxDecideInput,
  ordinal: number,
): Promise<RecordedCall> {
  const rate = decl.autonomy?.audit ?? 0;
  const run = options.runId ?? options.journal?.runId ?? "run";
  const draw = auditDraw(`${run}:${decl.name}#${ordinal}`, rate);
  try {
    providerCalls += 1;
    const response = await callProvider(decl, options);
    return { response, outage: false, audited: draw.audited, propensity: draw.propensity };
  } catch (err) {
    if (err instanceof DecisionOutageError) {
      return { outage: true, audited: false, propensity: draw.propensity };
    }
    throw err;
  }
}

async function callProvider(decl: AiDecisionDecl, options: FxDecideInput): Promise<DecisionResponse> {
  if (providerOverride) return providerOverride(decl, options.input, options.signal);
  const model =
    decl.model ?? (decl.driverId === "typesafe" ? TYPESAFE_JEV_MODEL : OPENROUTER_JEV_MODEL);
  const keyName = decl.driverId === "typesafe" ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = await options.getSecret?.(keyName);
  if (!apiKey) throw new DecisionConfigError(keyName);
  const timeoutMs = decisionTimeoutMs(decl.timeout);
  const provider =
    decl.driverId === "typesafe"
      ? createTypesafeDecisionProvider(apiKey, timeoutMs)
      : createOpenRouterDecisionProvider(apiKey, timeoutMs);
  return provider.evaluate({
    model,
    state: options.input,
    questions: wireQuestions(decl),
    signal: options.signal,
  });
}

function decisionTimeoutMs(timeout: AiDecisionDecl["timeout"]): number {
  if (typeof timeout === "number" && timeout > 0) return timeout;
  if (typeof timeout === "string") {
    const parsed = parseDurationMs(timeout);
    if (parsed > 0) return parsed;
  }
  return 30_000;
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

/** One question as journaled. Replay returns this; it is not re-projected. */
interface JournaledQuestion {
  readonly value: unknown;
  readonly how: DecisionHow;
  readonly p: number;
  readonly raw: unknown;
  readonly audited?: boolean;
  /** True when this question did not clear autonomy. */
  readonly uncertain: boolean;
}

/** Projection stored on the journal. The live lock is not consulted on replay. */
interface JournaledView {
  readonly auto: boolean;
  readonly reason?: DecisionUncertainty;
  readonly locale?: string;
  readonly lockModel?: string;
  readonly audited: boolean;
  readonly propensity: number;
  readonly questions: Readonly<Record<string, JournaledQuestion>>;
  readonly meta: {
    readonly model?: string;
    readonly provider: string;
    readonly usage: DecisionResponse["usage"] | Record<string, never>;
  };
}

function project(decl: AiDecisionDecl, input: unknown, recorded: RecordedCall): JournaledView {
  const locale = decl.locale?.(input);
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
  const questions: Record<string, JournaledQuestion> = {};
  for (const [id, question] of Object.entries(decl.ask)) {
    const slice = sliceFor(lock, id, locale);
    const answer = recorded.response?.answers[id];
    const calibrated = calibrateAnswer(question, answer, slice);
    let questionAuto = auto && slice !== undefined && calibrated.p >= (slice?.threshold ?? 1);
    if (calibrated.value === "none_of_these") {
      questionAuto = false;
      reason = reason ?? "low-confidence";
    } else if (slice === undefined && !reason) {
      questionAuto = false;
      reason = locale ? "uncertified-locale" : "missing-lock";
    } else if (slice && questionHash(question) !== slice.hash) {
      questionAuto = false;
      reason = reason ?? "stale-hash";
    } else if (slice && calibrated.p < slice.threshold) {
      questionAuto = false;
      reason = reason ?? "low-confidence";
    }
    if (!questionAuto) auto = false;
    const how: DecisionHow = questionAuto ? "auto" : decl.mode === "abstain" ? "abstained" : "auto";
    questions[id] = {
      value: questionAuto || decl.mode !== "abstain" ? calibrated.value : null,
      how,
      p: calibrated.p,
      raw: calibrated.raw,
      uncertain: !questionAuto,
      ...(recorded.audited && questionAuto ? { audited: true } : {}),
    };
  }
  return {
    auto,
    ...(reason !== undefined ? { reason } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(lock?.model !== undefined ? { lockModel: lock.model } : {}),
    audited: recorded.audited,
    propensity: recorded.propensity,
    questions,
    meta: {
      model: recorded.response?.model,
      provider: recorded.response?.provider ?? decl.driverId,
      usage: recorded.response?.usage ?? {},
    },
  };
}

function materialize(view: JournaledView): Record<string, unknown> {
  const dollar: Record<string, unknown> = { meta: view.meta };
  const result: Record<string, unknown> = { $: dollar };
  for (const [id, question] of Object.entries(view.questions)) {
    result[id] = question.value;
    dollar[id] = {
      how: question.how,
      p: question.p,
      raw: question.raw,
      ...(question.audited ? { audited: true } : {}),
    };
  }
  return result;
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
    const probability = calibrateBoolean(noul, calibrator);
    const p = Math.max(probability, 1 - probability);
    return { value: probability >= 0.5, p, raw: { noul } };
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
    const named = keys.map((key) => (typeof record[key] === "number" ? record[key] : 0));
    const namedHit = named.some((value) => value > 0);
    if (!namedHit && question.kind === "score") {
      const indexed = keys.map((_, index) => {
        const value = record[String(index)];
        return typeof value === "number" ? value : 0;
      });
      if (indexed.some((value) => value > 0)) return { keys, values: indexed };
    }
    return { keys, values: named };
  }
  if (Array.isArray(raw)) {
    return { keys, values: keys.map((_, i) => (typeof raw[i] === "number" ? raw[i] : 0)) };
  }
  return { keys, values: keys.map(() => 0) };
}

function reviewed(
  view: JournaledView,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next = materialize(view);
  const dollar = next.$ as Record<string, unknown>;
  for (const [id, value] of Object.entries(values)) {
    next[id] = value;
    const slot = dollar[id];
    if (slot && typeof slot === "object") {
      dollar[id] = { ...(slot as Record<string, unknown>), how: "reviewed" };
    }
  }
  return next;
}

function pendingRecord(
  options: FxDecideInput,
  view: JournaledView,
  labelOnly: boolean,
): DecisionReviewRecord {
  return {
    status: "pending",
    requestedAt: options.now(),
    tenant: options.tenantId ?? null,
    ...(view.locale !== undefined ? { locale: view.locale } : {}),
    propensity: labelOnly ? view.propensity : 1,
    labelOnly,
    open: Object.entries(view.questions)
      .filter(([, question]) => question.uncertain)
      .map(([id]) => id),
    ...(view.meta.model !== undefined ? { model: view.meta.model } : {}),
    scores: Object.fromEntries(Object.entries(view.questions).map(([id, question]) => [id, question.p])),
    raws: Object.fromEntries(Object.entries(view.questions).map(([id, question]) => [id, question.raw])),
    modelValues: Object.fromEntries(
      Object.entries(view.questions).map(([id, question]) => [id, question.value]),
    ),
    ...(view.reason !== undefined ? { reason: view.reason } : {}),
  };
}

function reviewId(runId: string, ordinal: number, name: string): string {
  return Buffer.from(`${runId}.${ordinal}.${name}`, "utf8").toString("base64url");
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
  input: {
    readonly values: Readonly<Record<string, unknown>>;
    readonly reviewer: string;
    readonly tenantId?: string | null;
    /** Operator plane resolves every tenant. The row keeps its tenant stamp. */
    readonly plane?: "user" | "operator";
    /** Resolver auth. The review gate sees this, not an empty principal. */
    readonly auth?: GatePolicyContext["auth"];
  },
  now: () => number = Date.now,
  labelOnly = false,
): Promise<DecisionReviewResult> {
  const parsed = parseReviewId(id);
  if (!parsed || typeof store.cas !== "function") return { ok: false, status: 404 };
  const decl = aiDecisionRegistry.find((item) => item.name === parsed.name);
  if (!decl) return { ok: false, status: 404 };
  if (!(await reviewGateAllows(decl.review, input))) return { ok: false, status: 403 };
  const name = decisionStepName(id, labelOnly);
  const token = crypto.randomUUID();
  const at = now();
  let stop: DecisionReviewResult | undefined;
  const claimed = await store.cas(parsed.runId, token, at, JOURNAL_DEFAULT_LEASE_MS, (run) => {
    const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
    if (!entry || entry.kind !== "step") {
      stop = { ok: false, status: 404 };
      return undefined;
    }
    const current = entry.value as DecisionReviewRecord;
    if (current.status !== "pending") {
      stop = { ok: false, status: 409, reason: "resolved" };
      return undefined;
    }
    if (input.plane !== "operator" && (input.tenantId ?? null) !== current.tenant) {
      stop = { ok: false, status: 403 };
      return undefined;
    }
    if (!valuesMatchQuestions(decl, current, input.values)) {
      stop = { ok: false, status: 422 };
      return undefined;
    }
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
    return { ...run, entries, wakeAt: at };
  });
  if (claimed === "missing") return { ok: false, status: 404 };
  if (typeof claimed === "object") {
    const retryAfterSeconds = leaseRetryAfterSeconds(claimed.leaseExpiresAt, at);
    if (retryAfterSeconds > DECISION_RETRY_CAP_SECONDS) {
      return { ok: false, status: 503, reason: "outage" };
    }
    return { ok: false, status: 409, reason: "lease", retryAfterSeconds };
  }
  if (stop) {
    await store.releaseLease?.(parsed.runId, token);
    return stop;
  }
  try {
    const run = await store.get(parsed.runId);
    if (!run) return { ok: false, status: 404 };
    const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
    if (!entry || entry.kind !== "step") return { ok: false, status: 404 };
    const current = entry.value as DecisionReviewRecord;
    for (const [question, value] of Object.entries(input.values)) {
      const label = {
        decision: parsed.name,
        question,
        value,
        propensity: current.propensity,
        reviewer: input.reviewer,
        ...(current.locale !== undefined ? { locale: current.locale } : {}),
        ...(current.tenant !== null ? { tenant: current.tenant } : {}),
        ...(current.model !== undefined ? { model: current.model } : {}),
        ...(current.scores?.[question] !== undefined ? { score: current.scores[question] } : {}),
        ...(current.raws?.[question] !== undefined ? { raw: current.raws[question] } : {}),
        loss: current.modelValues?.[question] === value ? 0 : 1,
        at,
      };
      recordDecisionLabel(label);
      persistDecisionLabel(label, at);
    }
    await flushDecisionLabels();
    return { ok: true };
  } finally {
    await store.releaseLease?.(parsed.runId, token);
  }
}

async function reviewGateAllows(
  gateName: string | undefined,
  input: {
    readonly reviewer: string;
    readonly auth?: GatePolicyContext["auth"];
    readonly tenantId?: string | null;
  },
): Promise<boolean> {
  if (!gateName) return true;
  const ctx: GatePolicyContext = {
    auth: input.auth ?? { userId: null, scopes: new Set<string>() },
    operator: { id: input.reviewer },
    ...(input.tenantId ? { meta: { tenant: input.tenantId } } : {}),
  };
  if (decisionAllow) return decisionAllow([gateName], ctx);
  const { createGateRuntime } = await import("../elements/gate/runtime.ts");
  return createGateRuntime({ gates: gateRegistry }).allow([gateName], ctx);
}

function valuesMatchQuestions(
  decl: AiDecisionDecl,
  current: DecisionReviewRecord,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const open = current.labelOnly ? Object.keys(decl.ask) : (current.open ?? Object.keys(decl.ask));
  const keys = Object.keys(values);
  if (keys.length !== open.length) return false;
  for (const key of keys) {
    if (!open.includes(key)) return false;
    const question = decl.ask[key];
    if (!question || !valueMatchesQuestion(question, values[key])) return false;
  }
  return true;
}

function valueMatchesQuestion(question: AiDecisionQuestion, value: unknown): boolean {
  if (question.kind === "boolean") return typeof value === "boolean";
  if (question.kind === "choice") {
    return (
      typeof value === "string" &&
      (value === "none_of_these" || Object.prototype.hasOwnProperty.call(question.options, value))
    );
  }
  return typeof value === "string" && question.levels.includes(value);
}

function parseReviewId(
  id: string,
): { readonly runId: string; readonly ordinal: number; readonly name: string } | undefined {
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const first = decoded.indexOf(".");
    const second = first >= 0 ? decoded.indexOf(".", first + 1) : -1;
    if (first <= 0 || second <= first + 1) return undefined;
    const ordinal = Number(decoded.slice(first + 1, second));
    const name = decoded.slice(second + 1);
    if (!Number.isInteger(ordinal) || ordinal < 0 || !name) return undefined;
    return { runId: decoded.slice(0, first), ordinal, name };
  } catch {
    return undefined;
  }
}
