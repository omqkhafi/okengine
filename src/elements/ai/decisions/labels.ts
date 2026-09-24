/**
 * Persisted decision labels and the app-level drift flag.
 * One SQLite table at the app root, shared by every instance.
 */

import { Database } from "bun:sqlite";
import { binomialCdf, decisionLabels, type DecisionLabel } from "./certificate.ts";

/** System table for review and audit labels. */
export const DECISION_LABEL_TABLE = "oke_decision_labels";

/** One-row table for the app drift flag. */
export const DECISION_DRIFT_TABLE = "oke_decision_drift";

let db: Database | undefined;

/**
 * Open the label store at an app root and load the drift flag.
 *
 * @param root - Directory that holds the app config
 * @param setDrift - Install the loaded flag
 */
export function openDecisionLabelStore(root: string, setDrift: (suspended: boolean) => void): void {
  db?.close();
  db = new Database(`${root}/oke-decisions.labels.sqlite`, { create: true });
  db.run(`create table if not exists ${DECISION_LABEL_TABLE} (
    decision_id text not null,
    question text not null,
    value text not null,
    propensity real not null,
    reviewer text not null,
    locale text,
    model text,
    tenant text,
    score real,
    loss integer,
    at integer not null
  )`);
  db.run(`create table if not exists ${DECISION_DRIFT_TABLE} (
    id integer primary key,
    suspended integer not null
  )`);
  const row = db.query(`select suspended from ${DECISION_DRIFT_TABLE} where id = 1`).get() as
    | { suspended: number }
    | null;
  setDrift(row?.suspended === 1);
}

/**
 * Close the label store. Tests use this.
 */
export function closeDecisionLabelStore(): void {
  db?.close();
  db = undefined;
}

/**
 * Write one label. Tenant scopes the row. The candidate job reads every tenant.
 *
 * @param label - Resolved label
 * @param at - Epoch ms
 */
export function persistDecisionLabel(label: DecisionLabel, at = Date.now()): void {
  if (!db) return;
  db.run(
    `insert into ${DECISION_LABEL_TABLE}
      (decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss, at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      label.decision,
      label.question,
      JSON.stringify(label.value),
      label.propensity,
      label.reviewer,
      label.locale ?? null,
      label.model ?? null,
      label.tenant ?? null,
      label.score ?? null,
      label.loss ?? null,
      at,
    ],
  );
}

/**
 * Labels for one decision. Omit `tenant` to read every tenant.
 *
 * @param decision - Decision name
 * @param tenant - Tenant filter
 */
export function loadDecisionLabels(decision?: string, tenant?: string | null): DecisionLabel[] {
  if (!db) {
    return decisionLabels().filter((label) => {
      if (decision !== undefined && label.decision !== decision) return false;
      if (tenant !== undefined && (label.tenant ?? null) !== tenant) return false;
      return true;
    });
  }
  const clauses: string[] = [];
  const args: (string | null)[] = [];
  if (decision !== undefined) {
    clauses.push("decision_id = ?");
    args.push(decision);
  }
  if (tenant !== undefined) {
    clauses.push("tenant is ?");
    args.push(tenant);
  }
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const rows = db
    .query(
      `select decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss
       from ${DECISION_LABEL_TABLE} ${where}`,
    )
    .all(...args) as {
    decision_id: string;
    question: string;
    value: string;
    propensity: number;
    reviewer: string;
    locale: string | null;
    model: string | null;
    tenant: string | null;
    score: number | null;
    loss: number | null;
  }[];
  return rows.map((row) => ({
    decision: row.decision_id,
    question: row.question,
    value: JSON.parse(row.value) as unknown,
    propensity: row.propensity,
    reviewer: row.reviewer,
    ...(row.locale !== null ? { locale: row.locale } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.tenant !== null ? { tenant: row.tenant } : {}),
    ...(row.score !== null ? { score: row.score } : {}),
    ...(row.loss !== null ? { loss: row.loss } : {}),
  }));
}

/**
 * Compare persisted audit labels to the certified error cap.
 * Audit rows are the ones whose propensity is the audit rate, below 1.
 *
 * @param maxError - Certified risk
 * @param delta - Test level
 */
export function auditDriftExceeded(maxError: number, delta = 0.1): boolean {
  const audits = loadDecisionLabels().filter((label) => label.propensity < 1 && label.loss !== undefined);
  if (audits.length === 0) return false;
  const errors = audits.filter((label) => (label.loss ?? 0) > 0).length;
  const tail = 1 - binomialCdf(errors - 1, audits.length, maxError);
  return tail <= delta;
}

/**
 * Persist the app-level suspension flag.
 *
 * @param suspended - Drift detected
 */
export function persistDecisionDrift(suspended: boolean): void {
  if (!db) return;
  db.run(
    `insert into ${DECISION_DRIFT_TABLE} (id, suspended) values (1, ?)
     on conflict(id) do update set suspended = excluded.suspended`,
    [suspended ? 1 : 0],
  );
}
