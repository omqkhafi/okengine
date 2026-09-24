/**
 * Decision labels and the app drift flag on the journal driver.
 * Boot opens the store only when the app declares decisions.
 */

import type { JournalStore } from "../../../kernel/journal.ts";
import type {
  DecisionDriftRecord,
  DecisionLabelStore,
} from "../../../kernel/decision-label-store.ts";
import { binomialCdf, decisionLabels, getDecisionLock, type DecisionLabel } from "./certificate.ts";

/** Rolling window for audit drift. Labels older than this are ignored. */
export const DECISION_DRIFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let store: DecisionLabelStore | undefined;
let writes: Promise<void> = Promise.resolve();

/**
 * Bind the journal's decision store and load the drift flag.
 *
 * @param journal - Journal that owns the label table
 * @param setDrift - Install the loaded flag
 */
export async function openDecisionLabelStore(
  journal: JournalStore,
  setDrift: (suspended: boolean) => void,
): Promise<void> {
  await writes;
  store = journal.decisions;
  if (!store) return;
  const flag = await store.drift();
  setDrift(flag.suspended && newestCertificateAt() <= flag.certifiedAt);
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
}

/**
 * Write one label. Tenant scopes the row. The candidate job reads every tenant.
 *
 * @param label - Resolved label
 * @param at - Epoch ms
 */
export function persistDecisionLabel(label: DecisionLabel, at = Date.now()): void {
  const row = { ...label, at };
  if (!store) return;
  const target = store;
  const write = (): Promise<void> =>
    target.insert(row, at).then(
      () => undefined,
      () => undefined,
    );
  writes = writes.then(write, write);
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
 * Persist the app-level suspension flag.
 *
 * @param suspended - Drift detected
 */
export function persistDecisionDrift(suspended: boolean, certifiedAt = 0): void {
  if (!store) return;
  const target = store;
  const record: DecisionDriftRecord = { suspended, certifiedAt };
  const write = (): Promise<void> =>
    target.setDrift(record).then(
      () => undefined,
      () => undefined,
    );
  writes = writes.then(write, write);
}

/**
 * Newest certificate time in the loaded lockfile. `0` when none is stamped.
 */
function newestCertificateAt(): number {
  const decisions = getDecisionLock()?.decisions ?? {};
  let newest = 0;
  for (const entry of Object.values(decisions)) {
    const at = entry.certifiedAt ?? 0;
    if (at > newest) newest = at;
  }
  return newest;
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
