/**
 * Decision certificates. The lockfile is the only autonomy grant.
 * The runtime can force review or abstain; it never raises a threshold.
 */

import { createHash } from "node:crypto";

/** Temperature scaling for choice and score. */
export interface TemperatureCalibrator {
  readonly kind: "temperature";
  readonly t: number;
}

/** Platt scaling for a boolean `noul` probability. */
export interface PlattCalibrator {
  readonly kind: "platt";
  readonly a: number;
  readonly b: number;
}

/** Beta scaling for a boolean `noul` probability. `c` is the scale. */
export interface BetaCalibrator {
  readonly kind: "beta";
  readonly a: number;
  readonly b: number;
  readonly c?: number;
}

/** Calibrator stored on one certificate slice. */
export type DecisionCalibrator = TemperatureCalibrator | PlattCalibrator | BetaCalibrator;

/** One locale slice. Absent `locale` is the empty-string slice. */
export interface DecisionCertSlice {
  readonly hash: string;
  readonly calibrator: DecisionCalibrator;
  readonly threshold: number;
  readonly metrics?: Readonly<Record<string, number>>;
}

/** One decision inside `oke-decisions.lock.json`. */
export interface DecisionLockEntry {
  readonly model: string;
  readonly questions: Readonly<Record<string, Readonly<Record<string, DecisionCertSlice>>>>;
}

/** App lockfile. Lives next to that app's OKE config. */
export interface DecisionLockfile {
  readonly decisions: Readonly<Record<string, DecisionLockEntry>>;
}

/** Why a question is not auto. */
export type DecisionUncertainty =
  | "low-confidence"
  | "missing-lock"
  | "stale-hash"
  | "version-mismatch"
  | "uncertified-locale"
  | "drift"
  | "outage";

/** Label row written when a review resolves. */
export interface DecisionLabel {
  readonly decision: string;
  readonly question: string;
  readonly value: unknown;
  readonly propensity: number;
  readonly reviewer: string;
  readonly locale?: string;
  readonly tenant?: string;
  readonly model?: string;
  /** Calibrated confidence used by Learn-then-Test. */
  readonly score?: number;
  /** 1 when the label disagrees with the model, else 0. */
  readonly loss?: number;
}

/** App-wide candidate. A full lock entry, not a count. */
export interface DecisionCandidate {
  readonly model: string;
  readonly questions: DecisionLockEntry["questions"];
}

/** Lockfile name at the app project root. */
export const DECISION_LOCK_FILENAME = "oke-decisions.lock.json";

const labels: DecisionLabel[] = [];
let lockfile: DecisionLockfile | undefined;
let suspended = false;
const candidates = new Map<string, DecisionCandidate>();

/**
 * Replace the in-memory lock. `undefined` is a missing lockfile.
 *
 * @param next - Lockfile, or none
 */
export function setDecisionLock(next: DecisionLockfile | undefined): void {
  lockfile = next;
}

/**
 * Current lockfile, if one was loaded or promoted.
 */
export function getDecisionLock(): DecisionLockfile | undefined {
  return lockfile;
}

/**
 * App-level drift flag. One flag for the whole app.
 *
 * @param next - Suspend autonomy when true
 */
export function setDecisionDrift(next: boolean): void {
  suspended = next;
}

/**
 * Whether drift has suspended every certificate.
 */
export function decisionDriftSuspended(): boolean {
  return suspended;
}

/**
 * Labels collected by review resolution, including audit reviews.
 */
export function decisionLabels(): readonly DecisionLabel[] {
  return labels;
}

/**
 * Drop lock, labels, drift, and candidates. Tests only.
 */
export function resetDecisionCertificates(): void {
  labels.length = 0;
  lockfile = undefined;
  suspended = false;
  candidates.clear();
}

/**
 * Stable hash of a question's instructions and options.
 *
 * @param question - Author question
 */
export function questionHash(question: {
  readonly instructions: string;
  readonly options?: Readonly<Record<string, string | null>>;
  readonly levels?: readonly string[];
}): string {
  const body = JSON.stringify({
    instructions: question.instructions,
    options: question.options ?? null,
    levels: question.levels ?? null,
  });
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Temperature-scale a distribution. `t = 1` leaves it unchanged.
 *
 * @param probs - Probabilities that sum to about 1
 * @param t - Temperature
 */
export function applyTemperature(probs: readonly number[], t: number): number[] {
  const temp = t > 0 ? t : 1;
  const scaled = probs.map((p) => Math.pow(Math.max(p, 1e-12), 1 / temp));
  const z = scaled.reduce((sum, p) => sum + p, 0);
  return scaled.map((p) => p / z);
}

/**
 * Calibrated P(true). Confidence is `max(p, 1 - p)` at the call site.
 *
 * @param noul - Provider probability of the true class
 * @param calibrator - Platt or beta
 */
export function calibrateBoolean(
  noul: number,
  calibrator: PlattCalibrator | BetaCalibrator,
): number {
  const p = Math.min(1, Math.max(0, noul));
  if (calibrator.kind === "platt") {
    const logit = Math.log(Math.max(p, 1e-12) / Math.max(1 - p, 1e-12));
    const z = calibrator.a * logit + calibrator.b;
    return 1 / (1 + Math.exp(-z));
  }
  const a = calibrator.a;
  const b = calibrator.b;
  if (calibrator.c !== undefined) {
    const ratio = Math.pow(1 - p, b) / Math.pow(Math.max(p, 1e-12), a);
    return 1 / (1 + Math.exp(-calibrator.c * ratio));
  }
  return (a * p) / (a * p + b * (1 - p) || 1);
}

/**
 * One-sided exact binomial cdf, `P(X ≤ k)` for `X ~ Binomial(n, p)`.
 *
 * @param k - Observed errors
 * @param n - Accepted labels
 * @param p - Boundary error rate
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (n <= 0) return 1;
  if (p <= 0) return k >= 0 ? 1 : 0;
  if (p >= 1) return k >= n ? 1 : 0;
  const errors = Math.max(0, Math.min(n, k));
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let i = 0; i < errors; i++) {
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * Learn-then-Test. Scans thresholds from strict to loose and stops at the
 * first exact binomial test that fails. Too few labels returns null.
 *
 * @param rows - Score and 0/1 loss
 * @param maxError - Risk cap
 * @param delta - Test level. Default `0.1`
 */
export function learnThenTest(
  rows: readonly { readonly score: number; readonly loss: number }[],
  maxError: number,
  delta = 0.1,
): number | null {
  if (rows.length === 0) return null;
  const thresholds = [...new Set(rows.map((row) => row.score))].sort((a, b) => b - a);
  let chosen: number | null = null;
  for (const threshold of thresholds) {
    const accepted = rows.filter((row) => row.score >= threshold);
    const errors = accepted.reduce((sum, row) => sum + (row.loss > 0 ? 1 : 0), 0);
    if (binomialCdf(errors, accepted.length, maxError) > delta) break;
    chosen = threshold;
  }
  return chosen;
}

/**
 * Record a label. The reviewer Flow owns this write.
 *
 * @param label - Resolved label
 */
export function recordDecisionLabel(label: DecisionLabel): void {
  labels.push(label);
}

/**
 * Build one lock entry from stored labels. The same fit and test as certify.
 *
 * @param decision - Decision name
 * @param fit - Turns that decision's labels into a lock entry
 */
export function aggregateDecisionCandidate(
  decision: string,
  fit: (rows: readonly DecisionLabel[]) => DecisionCandidate = () => ({
    model: "",
    questions: {},
  }),
): DecisionCandidate {
  const rows = labels.filter((label) => label.decision === decision);
  const candidate = fit(rows);
  candidates.set(decision, candidate);
  return candidate;
}

/**
 * Candidate the admin endpoint serves. Undefined until the clock job runs.
 *
 * @param decision - Decision name
 */
export function getDecisionCandidate(decision: string): DecisionCandidate | undefined {
  return candidates.get(decision);
}

/**
 * Write a fetched candidate into the lockfile slot. Does not recompute it.
 *
 * @param name - Decision name
 * @param candidate - Body returned by the admin endpoint
 * @param current - Lockfile to merge into
 */
export function lockFromCandidate(
  name: string,
  candidate: unknown,
  current: DecisionLockfile | undefined,
): DecisionLockfile {
  const entry = parseDecisionLockEntry(candidate);
  if (!entry) throw new TypeError("promote: candidate is not a lock entry");
  return { decisions: { ...(current?.decisions ?? {}), [name]: entry } };
}

/**
 * Accept a lock entry with a model and a questions map.
 *
 * @param body - Candidate or file slot
 */
export function parseDecisionLockEntry(body: unknown): DecisionLockEntry | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.model !== "string") return undefined;
  if (!record.questions || typeof record.questions !== "object" || Array.isArray(record.questions)) {
    return undefined;
  }
  return { model: record.model, questions: record.questions as DecisionLockEntry["questions"] };
}

/**
 * Accept a lockfile object.
 *
 * @param body - Parsed JSON
 */
export function parseDecisionLockfile(body: unknown): DecisionLockfile | undefined {
  if (!body || typeof body !== "object") return undefined;
  const decisions = (body as { decisions?: unknown }).decisions;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) return undefined;
  const next: Record<string, DecisionLockEntry> = {};
  for (const [name, entry] of Object.entries(decisions)) {
    const parsed = parseDecisionLockEntry(entry);
    if (!parsed) return undefined;
    next[name] = parsed;
  }
  return { decisions: next };
}

/**
 * Read `oke-decisions.lock.json` from an app root and install it.
 * A missing file clears the in-memory lock.
 *
 * @param root - Directory that holds the app config
 */
export async function loadDecisionLockfile(root: string): Promise<DecisionLockfile | undefined> {
  const file = Bun.file(`${root}/${DECISION_LOCK_FILENAME}`);
  if (!(await file.exists())) {
    setDecisionLock(undefined);
    return undefined;
  }
  const parsed = parseDecisionLockfile(await file.json());
  setDecisionLock(parsed);
  return parsed;
}
