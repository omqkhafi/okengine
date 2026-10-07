/**
 * `fx.decide` — one provider request, journaled. Loaded with `lazyRequire`.
 */

import { aiDeciderRegistry, aiDecisionRegistry, gateRegistry } from "./element-registries.ts";
import type { GatePolicyContext } from "../elements/gate/declare.ts";
import type { AiDeciderDecl, AiDecisionDecl, AiDecisionQuestion } from "../elements/ai/declare.ts";
import {
  DecisionConfigError,
  DecisionInputTooLarge,
  DecisionOutageError,
  type DecisionResponse,
} from "../elements/ai/decisions/provider.ts";
import { parseDurationMs } from "../elements/clock/duration.ts";
import { decisionHttp } from "../elements/ai/decisions/http.ts";
import {
  encodeDecisionRequest,
  estimateDecisionTokens,
  normalizeDecisionResponse,
  wireQuestions,
} from "../elements/ai/decisions/codec.ts";
import {
  applyTemperature,
  calibrateBoolean,
  decisionDriftSuspended,
  getDecisionLock,
  questionHash,
  recordDecisionLabel,
  type DecisionCertSlice,
  type DecisionDeciderCert,
  type DecisionWhy,
} from "../elements/ai/decisions/certificate.ts";
import { flushDecisionLabels, persistDecisionLabel } from "../elements/ai/decisions/labels.ts";
import { decisionExportFields, maskDecisionInput } from "../elements/ai/decisions/export.ts";
import {
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
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
  /** Question ids that are not auto. Resolve must answer each of them. */
  readonly open?: readonly string[];
  readonly model?: string;
  readonly scores?: Readonly<Record<string, number>>;
  readonly raws?: Readonly<Record<string, unknown>>;
  readonly modelValues?: Readonly<Record<string, unknown>>;
  /** Calling input. Label export reads this. */
  readonly input?: unknown;
  readonly why?: DecisionWhy;
  /** Decider that answered, when one did. */
  readonly by?: string;
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
  decider: AiDeciderDecl,
) => Promise<DecisionResponse>;

/** Scripted probabilities, or a refusal signal that is not stored as a label. */
export type DecisionScriptAnswer =
  | { readonly probabilities: Readonly<Record<string, number>> }
  | { readonly probability: number }
  | { readonly refusal: string };

let providerOverride: ProviderFn | undefined;
let providerCalls = 0;
let decisionTransport: "live" | "mock" = "live";
const decisionScripts = new Map<string, Readonly<Record<string, DecisionScriptAnswer>>>();
const inflight = new Map<string, number>();
const waiters = new Map<string, Array<() => void>>();

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
  decisionTransport = "live";
  decisionScripts.clear();
  inflight.clear();
  waiters.clear();
}

/**
 * `mock` answers locally. `live` calls the decider host.
 *
 * @param transport - Boot selection from `drivers.decide`
 */
export function setDecisionTransport(transport: "live" | "mock"): void {
  decisionTransport = transport;
}

/**
 * Script one decision. `{ refusal }` is the test signal; the string is not stored.
 *
 * @param name - Decision name
 * @param answers - Per-question script, or undefined to clear
 */
export function setDecisionScript(
  name: string,
  answers: Readonly<Record<string, DecisionScriptAnswer>> | undefined,
): void {
  if (!answers) decisionScripts.delete(name);
  else decisionScripts.set(name, answers);
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
    ? await options.journal.effect("decide-provider", slot, () =>
        callAndDraw(decl, options, ordinal),
      )
    : await callAndDraw(decl, options, ordinal);
  const view = options.journal
    ? ((await options.journal.effect("decide-view", slot, () =>
        project(decl, options.input, recorded, options.now()),
      )) as JournaledView)
    : project(decl, options.input, recorded, options.now());
  if (view.auto) {
    if (view.audited && options.journal) {
      const id = reviewId(options.journal.runId, ordinal, name);
      await options.journal.step(decisionStepName(id, true), () =>
        pendingRecord(options, view, true, decl),
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
    pendingRecord(options, view, false, decl),
  )) as DecisionReviewRecord;
  // Always consume the sleep row. Resolve moves wakeAt to now.
  await options.journal.sleep(step, "876000h", () => 876000 * 60 * 60 * 1000);
  const resolved = readStepRecord(options.journal, step) ?? stored;
  return reviewed(view, resolved.values ?? {});
}

/** Completed `decide-provider` rows for this name. The current call is not included. */
function decideOrdinal(journal: JournalSession | undefined, name: string): number {
  if (!journal) return 0;
  return journal
    .recordedBeforeCursor()
    .filter(
      (entry) =>
        entry.kind === "effect" &&
        entry.effectKind === "decide-provider" &&
        entry.resource.startsWith(`${name}#`),
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
  readonly by?: string;
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
    const called = await callProvider(decl, options);
    return {
      response: called.response,
      by: called.by,
      outage: false,
      audited: draw.audited,
      propensity: draw.propensity,
    };
  } catch (err) {
    if (err instanceof DecisionOutageError) {
      return { outage: true, audited: false, propensity: draw.propensity };
    }
    throw err;
  }
}

async function callProvider(
  decl: AiDecisionDecl,
  options: FxDecideInput,
): Promise<{ readonly response: DecisionResponse; readonly by: string }> {
  const chain = deciderChain(decl);
  let last: unknown;
  for (let i = 0; i < chain.length; i += 1) {
    const decider = chain[i];
    if (!decider) continue;
    assertDecisionContext(decider, options.input);
    try {
      const response = await withDeciderConcurrency(decider, () => callOne(decl, decider, options));
      return { response, by: decider.name };
    } catch (err) {
      if (!(err instanceof DecisionOutageError) || i === chain.length - 1) throw err;
      last = err;
    }
  }
  throw last instanceof Error ? last : new DecisionOutageError("decision backup exhausted");
}

function deciderChain(decl: AiDecisionDecl): AiDeciderDecl[] {
  const names = [decl.decider, ...decl.backup];
  return names.map((name) => {
    const decider = aiDeciderRegistry.find((item) => item.name === name);
    if (!decider) throw new Error(`fx.decide: unknown decider "${name}"`);
    return decider;
  });
}

function assertDecisionContext(decider: AiDeciderDecl, input: unknown): void {
  const max = decider.capabilities.maxContext;
  if (typeof max !== "number") return;
  const tokens = estimateDecisionTokens(input);
  if (tokens > max) throw new DecisionInputTooLarge(decider.name, tokens, max);
}

async function withDeciderConcurrency<T>(
  decider: AiDeciderDecl,
  body: () => Promise<T>,
): Promise<T> {
  const limit = decider.concurrency;
  if (limit === undefined || limit < 1) return body();
  while ((inflight.get(decider.name) ?? 0) >= limit) {
    await new Promise<void>((resolve) => {
      const queue = waiters.get(decider.name) ?? [];
      queue.push(resolve);
      waiters.set(decider.name, queue);
    });
  }
  inflight.set(decider.name, (inflight.get(decider.name) ?? 0) + 1);
  try {
    return await body();
  } finally {
    inflight.set(decider.name, Math.max(0, (inflight.get(decider.name) ?? 1) - 1));
    waiters.get(decider.name)?.shift()?.();
  }
}

async function callOne(
  decl: AiDecisionDecl,
  decider: AiDeciderDecl,
  options: FxDecideInput,
): Promise<DecisionResponse> {
  const script = decisionScripts.get(decl.name);
  if (script && decider.name === decl.decider) return scriptedResponse(decl, decider, script);
  if (providerOverride) {
    return normalizeDecisionResponse(
      decider.protocol,
      await providerOverride(decl, options.input, options.signal, decider),
    );
  }
  if (decisionTransport === "mock") return mockResponse(decl, decider);
  const apiKey = await options.getSecret?.(decider.secret);
  if (!apiKey) throw new DecisionConfigError(decider.secret);
  const request = {
    model: decider.model,
    state: options.input,
    questions: wireQuestions(decl.ask),
    signal: options.signal,
  };
  const raw = await decisionHttp({
    url: decider.baseUrl,
    apiKey,
    request,
    body: encodeDecisionRequest(decider.protocol, request),
    timeoutMs: decisionTimeoutMs(decider.timeout),
    breakerKey: decider.name,
  });
  return normalizeDecisionResponse(decider.protocol, raw);
}

function scriptedResponse(
  decl: AiDecisionDecl,
  decider: AiDeciderDecl,
  script: Readonly<Record<string, DecisionScriptAnswer>>,
): DecisionResponse {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(decl.ask)) {
    const row = script[id];
    if (!row) {
      answers[id] = { type: "malformed" };
      continue;
    }
    if ("refusal" in row) {
      answers[id] = { type: "refusal" };
      continue;
    }
    if ("probability" in row) {
      answers[id] = { type: "boolean", probability: row.probability };
      continue;
    }
    if (question.kind === "boolean") {
      const probability = row.probabilities.true ?? row.probabilities.yes ?? 0;
      answers[id] = { type: "boolean", probability };
      continue;
    }
    const choice = argmaxKey(row.probabilities);
    answers[id] =
      question.kind === "score"
        ? { type: "score", score: choice, probabilities: row.probabilities }
        : { type: "choice", choice, probabilities: row.probabilities };
  }
  return { model: decider.model, provider: "script", answers, usage: {} };
}

function mockResponse(decl: AiDecisionDecl, decider: AiDeciderDecl): DecisionResponse {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(decl.ask)) {
    if (question.kind === "boolean") answers[id] = { type: "boolean", probability: 0.5 };
    else if (question.kind === "choice") {
      answers[id] = {
        type: "choice",
        choice: "none_of_these",
        probabilities: { none_of_these: 1 },
      };
    } else {
      const level = question.levels[0] ?? "";
      answers[id] = { type: "score", score: level, probabilities: { [level]: 1 } };
    }
  }
  return { model: decider.model, provider: "mock", answers, usage: {} };
}

function argmaxKey(probabilities: Readonly<Record<string, number>>): string {
  let best = "";
  let score = -1;
  for (const [key, value] of Object.entries(probabilities)) {
    if (value > score) {
      best = key;
      score = value;
    }
  }
  return best;
}

function decisionTimeoutMs(timeout: AiDeciderDecl["timeout"]): number {
  if (typeof timeout === "number" && timeout > 0) return timeout;
  if (typeof timeout === "string") {
    const parsed = parseDurationMs(timeout);
    if (parsed > 0) return parsed;
  }
  return 30_000;
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
  readonly why?: DecisionWhy;
}

/** Projection stored on the journal. The live lock is not consulted on replay. */
interface JournaledView {
  readonly auto: boolean;
  readonly why?: DecisionWhy;
  readonly by?: string;
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

function project(
  decl: AiDecisionDecl,
  input: unknown,
  recorded: RecordedCall,
  now: number,
): JournaledView {
  const locale = decl.locale?.(input);
  const drifted = decisionDriftSuspended(decl.name);
  const slot = recorded.by
    ? getDecisionLock()?.decisions[decl.name]?.deciders[recorded.by]
    : undefined;
  const expired = slot?.pinned === false && slot.expiresAt !== undefined && now >= slot.expiresAt;
  const mismatched = slot !== undefined && slot.model !== recorded.response?.model;
  const lock = slot && !expired && !mismatched ? slot : undefined;
  let blocked: DecisionWhy | undefined = recorded.outage
    ? "outage"
    : drifted
      ? "drift"
      : !decl.autonomy || !lock
        ? "uncertified"
        : undefined;
  const questions: Record<string, JournaledQuestion> = {};
  let auto = blocked === undefined;
  for (const [id, question] of Object.entries(decl.ask)) {
    const slice = sliceFor(lock, id, locale);
    const answer = answerAt(recorded.response?.answers, id);
    const calibrated = calibrateAnswer(question, answer, slice);
    let why: DecisionWhy | undefined = blocked;
    let questionAuto = auto && slice !== undefined && calibrated.p >= (slice?.threshold ?? 1);
    if (calibrated.refused) {
      questionAuto = false;
      why = "refused";
    } else if (calibrated.value === "none_of_these") {
      questionAuto = false;
      why = why ?? "none_of_these";
    } else if (!slice || questionHash(question) !== slice.hash) {
      questionAuto = false;
      why = why ?? "uncertified";
    } else if (calibrated.p < slice.threshold) {
      questionAuto = false;
      why = why ?? "uncertain";
    }
    if (!questionAuto) auto = false;
    const how: DecisionHow = questionAuto ? "auto" : decl.mode === "abstain" ? "abstained" : "auto";
    const value =
      calibrated.refused || (!questionAuto && decl.mode === "abstain") ? null : calibrated.value;
    questions[id] = {
      value,
      how,
      p: calibrated.p,
      raw: calibrated.raw,
      uncertain: !questionAuto,
      ...(!questionAuto && why ? { why } : {}),
      ...(recorded.audited && questionAuto ? { audited: true } : {}),
    };
  }
  const why = Object.values(questions).find((question) => question.why)?.why;
  return {
    auto,
    ...(why !== undefined ? { why } : {}),
    ...(recorded.by !== undefined ? { by: recorded.by } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(lock?.model !== undefined ? { lockModel: lock.model } : {}),
    audited: recorded.audited,
    propensity: recorded.propensity,
    questions,
    meta: {
      model: recorded.response?.model,
      provider: recorded.response?.provider ?? recorded.by ?? "",
      usage: recorded.response?.usage ?? {},
    },
  };
}

function answerAt(answers: DecisionResponse["answers"] | undefined, id: string): unknown {
  if (!answers || Array.isArray(answers)) return undefined;
  return (answers as Readonly<Record<string, unknown>>)[id];
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
      ...(view.by !== undefined ? { by: view.by } : {}),
      ...(question.why !== undefined ? { why: question.why } : {}),
      ...(question.audited ? { audited: true } : {}),
    };
  }
  return result;
}

function sliceFor(
  lock: DecisionDeciderCert | undefined,
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
): {
  readonly value: unknown;
  readonly p: number;
  readonly raw: unknown;
  readonly refused?: boolean;
} {
  const record = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  if (record.type === "refusal") {
    return { value: null, p: 0, raw: { type: "refusal" }, refused: true };
  }
  if (record.type === "malformed") {
    return { value: null, p: 0, raw: { type: "malformed" } };
  }
  if (question.kind === "boolean") {
    const noul =
      typeof record.probability === "number"
        ? record.probability
        : typeof record.noul === "number"
          ? record.noul
          : 0;
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
  decl: AiDecisionDecl,
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
    scores: Object.fromEntries(
      Object.entries(view.questions).map(([id, question]) => [id, question.p]),
    ),
    raws: Object.fromEntries(
      Object.entries(view.questions).map(([id, question]) => [id, question.raw]),
    ),
    modelValues: Object.fromEntries(
      Object.entries(view.questions).map(([id, question]) => [id, question.value]),
    ),
    ...(view.why !== undefined ? { why: view.why } : {}),
    ...(view.by !== undefined ? { by: view.by } : {}),
    input: maskDecisionInput(options.input, decisionExportFields(decl.inputSchema)),
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
    const maskedInput =
      current.input !== undefined
        ? maskDecisionInput(current.input, decisionExportFields(decl?.inputSchema))
        : undefined;
    for (const [question, value] of Object.entries(input.values)) {
      const label = {
        decision: parsed.name,
        question,
        value,
        propensity: current.propensity,
        reviewer: input.reviewer,
        reviewId: id,
        ...(current.locale !== undefined ? { locale: current.locale } : {}),
        ...(current.tenant !== null ? { tenant: current.tenant } : {}),
        ...(current.model !== undefined ? { model: current.model } : {}),
        ...(current.scores?.[question] !== undefined ? { score: current.scores[question] } : {}),
        ...(current.raws?.[question] !== undefined ? { raw: current.raws[question] } : {}),
        loss: current.modelValues?.[question] === value ? 0 : 1,
        ...(maskedInput !== undefined ? { input: maskedInput } : {}),
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
