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
  /** Epoch ms the certificate was written. Drift counts labels after this. */
  readonly certifiedAt?: number;
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
  /** Raw provider distribution the candidate fits. */
  readonly raw?: unknown;
  /** 1 when the label disagrees with the model, else 0. */
  readonly loss?: number;
  /** Epoch ms the label was written. */
  readonly at?: number;
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
 * Drop lock, labels, and drift. Tests only.
 */
export function resetDecisionCertificates(): void {
  labels.length = 0;
  lockfile = undefined;
  suspended = false;
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
  const c = calibrator.c ?? 0;
  const ratio = Math.pow(Math.max(1 - p, 1e-12), b) / Math.pow(Math.max(p, 1e-12), a);
  return 1 / (1 + Math.exp(-c) * ratio);
}

/**
 * One-sided exact binomial cdf, `P(X ≤ k)` for `X ~ Binomial(n, p)`.
 *
 * @param k - Observed errors
 * @param n - Accepted labels
 * @param p - Boundary error rate
 */
/** Fixed Learn-then-Test grid: 0.50 through 0.99, step 0.01. */
export const LEARN_THEN_TEST_GRID: readonly number[] = Array.from(
  { length: 50 },
  (_, i) => (50 + i) / 100,
);

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

/**
 * Log-gamma via Lanczos. Used so a binomial cdf at n = 20000 does not overflow.
 *
 * @param z - Positive argument
 */
function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  let x = LANCZOS[0];
  const shifted = z - 1;
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i]! / (shifted + i);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * One-sided exact binomial cdf, `P(X ≤ k)` for `X ~ Binomial(n, p)`.
 * `k < 0` is 0. The sum is in log space.
 *
 * @param k - Observed errors
 * @param n - Accepted labels
 * @param p - Boundary error rate
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (n <= 0) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  if (k >= n) return 1;
  const last = Math.floor(k);
  let logTerm = n * Math.log(1 - p);
  let maxLog = logTerm;
  const logs = [logTerm];
  for (let i = 0; i < last; i++) {
    logTerm += Math.log(n - i) - Math.log(i + 1) + Math.log(p) - Math.log(1 - p);
    logs.push(logTerm);
    if (logTerm > maxLog) maxLog = logTerm;
  }
  let sum = 0;
  for (const logP of logs) sum += Math.exp(logP - maxLog);
  const total = Math.exp(maxLog) * sum;
  return Math.min(1, Number.isFinite(total) ? total : 0);
}

/**
 * Learn-then-Test on a fixed threshold grid. A threshold passes only when
 * the error count is low under Binomial(n, maxError): `binomialCdf(errors, n, maxError) ≤ δ/m`
 * (Bonferroni). The loosest passing threshold wins. A grid with no pass returns null.
 *
 * @param rows - Score and 0/1 loss
 * @param maxError - Risk cap
 * @param delta - Family-wise level. Default `0.1` (`autonomy.risk`)
 */
export function learnThenTest(
  rows: readonly { readonly score: number; readonly loss: number }[],
  maxError: number,
  delta = 0.1,
): number | null {
  if (rows.length === 0) return null;
  const m = LEARN_THEN_TEST_GRID.length;
  const alpha = delta / m;
  let chosen: number | null = null;
  for (const threshold of LEARN_THEN_TEST_GRID) {
    const accepted = rows.filter((row) => row.score >= threshold);
    if (accepted.length === 0) continue;
    const errors = accepted.reduce((sum, row) => sum + (row.loss > 0 ? 1 : 0), 0);
    const pValue = binomialCdf(errors, accepted.length, maxError);
    if (pValue > alpha) continue;
    if (chosen === null || threshold < chosen) chosen = threshold;
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
  return fit(rows);
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
  setDecisionDrift(false);
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
  if (
    !record.questions ||
    typeof record.questions !== "object" ||
    Array.isArray(record.questions)
  ) {
    return undefined;
  }
  return {
    model: record.model,
    ...(typeof record.certifiedAt === "number" ? { certifiedAt: record.certifiedAt } : {}),
    questions: record.questions as DecisionLockEntry["questions"],
  };
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
