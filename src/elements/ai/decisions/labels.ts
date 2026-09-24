/**
 * Decision labels and the app drift flag on the journal driver.
 * Boot opens the store only when the app declares decisions.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { JournalStore } from "../../../kernel/journal.ts";
import type { RunTelemetry } from "../../../kernel/run-telemetry.ts";
import type {
  DecisionDriftRecord,
  DecisionLabelStore,
} from "../../../kernel/decision-label-store.ts";
import {
  binomialCdf,
  decisionLabels,
  getDecisionLock,
  type DecisionCandidate,
  type DecisionLabel,
} from "./certificate.ts";

/** Rolling window for audit drift. Labels older than this are ignored. */
export const DECISION_DRIFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let store: DecisionLabelStore | undefined;
let writes: Promise<void> = Promise.resolve();

/** Trace log attached to the run that queued the write. */
const telemetryScope = new AsyncLocalStorage<RunTelemetry>();

/** A failed label write. The chain continues; the error is not dropped. */
export interface DecisionLabelWriteFailure {
  readonly decision: string;
  readonly question: string;
  readonly message: string;
  readonly at: number;
}

const writeFailures: DecisionLabelWriteFailure[] = [];

/**
 * Recent label-write failures. Console reads this for the decisions page.
 */
export function decisionLabelWriteFailures(): readonly DecisionLabelWriteFailure[] {
  return writeFailures;
}

/**
 * Attach this run's telemetry so a failed label write lands on its trace.
 *
 * @param telemetry - Collector for the current invocation
 */
export function bindDecisionLabelTelemetry(telemetry: RunTelemetry): void {
  telemetryScope.enterWith(telemetry);
}

/**
 * Bind the journal's decision store and load the drift flag.
 *
 * @param journal - Journal that owns the label table
 * @param setDrift - Install the loaded flag
 */
export async function openDecisionLabelStore(
  journal: JournalStore,
  setDrift: (name: string, suspended: boolean) => void,
): Promise<void> {
  await writes;
  store = journal.decisions;
  if (!store) return;
  const flags = await store.drift();
  for (const [name, flag] of Object.entries(flags)) {
    const pinned = pinnedDecision(name);
    const suspended = flag.suspended && (pinned?.since ?? 0) <= flag.certifiedAt;
    setDrift(name, suspended);
  }
}

/**
 * Wait until label and drift writes have reached the journal driver.
 */
export function flushDecisionLabels(): Promise<void> {
  return writes;
}

/**
 * Drop the bound store. Tests use this.
 */
export function closeDecisionLabelStore(): void {
  store = undefined;
  writeFailures.length = 0;
}

/**
 * Write one label. Tenant scopes the row. The candidate job reads every tenant.
 *
 * @param label - Resolved label. `label.at` is the stored time when set.
 * @param at - Epoch ms used only when `label.at` is absent
 */
export function persistDecisionLabel(label: DecisionLabel, at?: number): void {
  const stamped = label.at ?? at ?? Date.now();
  const row = { ...label, at: stamped };
  if (!store) return;
  const target = store;
  const write = (): Promise<void> =>
    target.insert(row, stamped).then(
      () => undefined,
      (error: unknown) => {
        noteLabelWriteFailure(row, error);
      },
    );
  writes = writes.then(write, write);
}

/**
 * Write a candidate onto the journal driver.
 *
 * @param decision - Decision name
 * @param entry - Fitted lock entry
 */
export async function persistDecisionCandidate(
  decision: string,
  entry: DecisionCandidate,
): Promise<void> {
  await store?.putCandidate(decision, entry);
}

/**
 * Read one candidate from the journal driver.
 *
 * @param decision - Decision name
 */
export async function loadDecisionCandidate(
  decision: string,
): Promise<DecisionCandidate | undefined> {
  return store?.getCandidate(decision);
}

/**
 * Decision names that have a candidate on the journal driver.
 */
export async function listDecisionCandidates(): Promise<readonly string[]> {
  return (await store?.listCandidates()) ?? [];
}

/**
 * Record a failed label write on the run trace and for the decisions page.
 * The returned promise still fulfills so the next write runs.
 *
 * @param label - Row that did not persist
 * @param error - Driver error
 */
function noteLabelWriteFailure(label: DecisionLabel, error: unknown): void {
  const message = error instanceof Error ? error.message : "decision label write failed";
  const at = Date.now();
  writeFailures.push({
    decision: label.decision,
    question: label.question,
    message,
    at,
  });
  const telemetry = telemetryScope.getStore();
  if (!telemetry) return;
  telemetry.logs.push({
    level: "error",
    message: "decision label write failed",
    data: { decision: label.decision, question: label.question, error: message },
    at,
  });
}

/**
 * Labels for one decision. Omit `tenant` to read every tenant.
 * Reads the journal mirror when one is open, otherwise in-memory review labels.
 *
 * @param decision - Decision name
 * @param tenant - Tenant filter
 */
export async function loadDecisionLabels(
  decision?: string,
  tenant?: string | null,
): Promise<DecisionLabel[]> {
  if (store) return store.list(decision, tenant);
  return decisionLabels().filter((label) => {
    if (decision !== undefined && label.decision !== decision) return false;
    if (tenant !== undefined && (label.tenant ?? null) !== tenant) return false;
    return true;
  });
}

/**
 * Compare audit labels for the pinned model to the certified error cap.
 * Only labels since the certificate, inside the rolling window, count.
 * One-sided exact binomial. A single correct label does not suspend.
 *
 * @param options - Cap, pinned model, and certificate time
 */
export function auditDriftExceeded(options: {
  readonly maxError: number;
  readonly delta?: number;
  readonly model: string;
  readonly since: number;
  readonly now?: number;
  readonly windowMs?: number;
  readonly labels: readonly DecisionLabel[];
}): boolean {
  const delta = options.delta ?? 0.1;
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DECISION_DRIFT_WINDOW_MS;
  const floor = Math.max(options.since, now - windowMs);
  const audits = options.labels.filter((label) => {
    if (!(label.propensity < 1) || label.loss === undefined) return false;
    if (label.model !== options.model) return false;
    const at = label.at ?? 0;
    return at >= floor;
  });
  if (audits.length === 0) return false;
  const errors = audits.filter((label) => (label.loss ?? 0) > 0).length;
  const tail = 1 - binomialCdf(errors - 1, audits.length, options.maxError);
  return tail <= delta;
}

/**
 * Persist one decision's suspension flag.
 *
 * @param name - Decision name
 * @param suspended - Drift detected for that decision
 * @param certifiedAt - Certificate time the flag was raised against
 */
export function persistDecisionDrift(name: string, suspended: boolean, certifiedAt = 0): void {
  if (!store) return;
  const target = store;
  const record: DecisionDriftRecord = { suspended, certifiedAt };
  const write = async (): Promise<void> => {
    try {
      await target.setDrift(name, record);
    } catch (error) {
      noteLabelWriteFailure(
        { decision: name, question: "drift", value: null, propensity: 0, reviewer: "drift" },
        error,
      );
      throw error;
    }
  };
  writes = writes.then(write, write);
}

/**
 * Pinned model and certificate time for one decision, when a lock exists.
 *
 * @param name - Decision name
 */
export function pinnedDecision(
  name: string,
): { readonly model: string; readonly since: number } | undefined {
  const entry = getDecisionLock()?.decisions[name];
  if (!entry) return undefined;
  return { model: entry.model, since: entry.certifiedAt ?? 0 };
}
