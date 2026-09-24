/**
 * Decision labels and the drift flag on the journal driver.
 *
 * A sibling of `oke_idempotency`. Rows are not journal runs. Tables are
 * created only when this store is opened, which boot does when the app
 * declares decisions.
 *
 * @module
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DecisionLabel } from "../elements/ai/decisions/certificate.ts";

/** SQL surface the postgres journal client already exposes. */
export interface DecisionLabelSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/** Persistence for review labels and the app drift flag. */
export interface DecisionLabelStore {
  insert(label: DecisionLabel, at: number): Promise<void>;
  /**
   * Labels for one decision. Omit `tenant` to read every tenant.
   *
   * @param decision - Decision name
   * @param tenant - Tenant filter
   */
  list(decision?: string, tenant?: string | null): Promise<DecisionLabel[]>;
  /** App-level suspension flag. */
  drift(): Promise<boolean>;
  /** Persist the app-level suspension flag. */
  setDrift(suspended: boolean): Promise<void>;
}

interface StoredLabel extends DecisionLabel {
  readonly at: number;
}

/**
 * In-memory label store.
 */
export function createMemoryDecisionLabelStore(): DecisionLabelStore {
  const rows: StoredLabel[] = [];
  let suspended = false;
  return {
    async insert(label, at) {
      rows.push({ ...label, at });
    },
    async list(decision, tenant) {
      return rows
        .filter((row) => decision === undefined || row.decision === decision)
        .filter((row) => tenant === undefined || (row.tenant ?? null) === tenant)
        .map(toLabel);
    },
    async drift() {
      return suspended;
    },
    async setDrift(next) {
      suspended = next;
    },
  };
}

/**
 * File-backed label store beside the journal file.
 *
 * @param path - JSON file path
 */
export function createFileDecisionLabelStore(path: string): DecisionLabelStore {
  let rows: StoredLabel[] | undefined;
  let suspended = false;
  const load = async (): Promise<void> => {
    if (rows) return;
    rows = [];
    const file = Bun.file(path);
    if (await file.exists()) {
      const raw = (await file.json()) as { rows?: StoredLabel[]; suspended?: boolean };
      rows = raw.rows ?? [];
      suspended = raw.suspended === true;
    }
  };
  const flush = async (): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify({ rows, suspended }));
  };
  return {
    async insert(label, at) {
      await load();
      rows!.push({ ...label, at });
      await flush();
    },
    async list(decision, tenant) {
      await load();
      return rows!
        .filter((row) => decision === undefined || row.decision === decision)
        .filter((row) => tenant === undefined || (row.tenant ?? null) === tenant)
        .map(toLabel);
    },
    async drift() {
      await load();
      return suspended;
    },
    async setDrift(next) {
      await load();
      suspended = next;
      await flush();
    },
  };
}

const memoryBySql = new WeakMap<DecisionLabelSql, DecisionLabelStore>();

/**
 * Postgres label store on the journal connection. Creates the tables.
 * A SQL fake that cannot read the table keeps an in-memory store on that client.
 *
 * @param sql - Journal SQL client
 */
export async function createPostgresDecisionLabelStore(
  sql: DecisionLabelSql,
): Promise<DecisionLabelStore> {
  const cached = memoryBySql.get(sql);
  if (cached) return cached;
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_decision_labels (
    decision_id TEXT NOT NULL,
    question TEXT NOT NULL,
    value TEXT NOT NULL,
    propensity DOUBLE PRECISION NOT NULL,
    reviewer TEXT NOT NULL,
    locale TEXT,
    model TEXT,
    tenant TEXT,
    score DOUBLE PRECISION,
    loss INTEGER,
    raw TEXT,
    at BIGINT NOT NULL
  )`);
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_decision_drift (
    id INTEGER PRIMARY KEY,
    suspended INTEGER NOT NULL
  )`);
  try {
    await sql.query(`SELECT decision_id FROM oke_decision_labels WHERE decision_id = ?`, [""]);
  } catch {
    const memory = createMemoryDecisionLabelStore();
    memoryBySql.set(sql, memory);
    return memory;
  }
  const store: DecisionLabelStore = {
    async insert(label, at) {
      await sql.exec(
        `INSERT INTO oke_decision_labels
          (decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss, raw, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          label.raw === undefined ? null : JSON.stringify(label.raw),
          at,
        ],
      );
    },
    async list(decision, tenant) {
      const clauses: string[] = [];
      const args: (string | null)[] = [];
      if (decision !== undefined) {
        clauses.push("decision_id = ?");
        args.push(decision);
      }
      if (tenant !== undefined) {
        clauses.push("tenant IS ?");
        args.push(tenant);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const found = await sql.query(
        `SELECT decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss, raw, at
         FROM oke_decision_labels ${where}`,
        args,
      );
      return found.map((row) => ({
        decision: String(row.decision_id),
        question: String(row.question),
        value: JSON.parse(String(row.value)) as unknown,
        propensity: Number(row.propensity),
        reviewer: String(row.reviewer),
        ...(row.locale != null ? { locale: String(row.locale) } : {}),
        ...(row.model != null ? { model: String(row.model) } : {}),
        ...(row.tenant != null ? { tenant: String(row.tenant) } : {}),
        ...(row.score != null ? { score: Number(row.score) } : {}),
        ...(row.loss != null ? { loss: Number(row.loss) } : {}),
        ...(row.raw != null ? { raw: JSON.parse(String(row.raw)) as unknown } : {}),
        at: Number(row.at),
      }));
    },
    async drift() {
      const rows = await sql.query(`SELECT suspended FROM oke_decision_drift WHERE id = 1`);
      return Number(rows[0]?.suspended) === 1;
    },
    async setDrift(next) {
      await sql.exec(
        `INSERT INTO oke_decision_drift (id, suspended) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET suspended = excluded.suspended`,
        [next ? 1 : 0],
      );
    },
  };
  memoryBySql.set(sql, store);
  return store;
}

function toLabel(row: StoredLabel): DecisionLabel {
  return {
    decision: row.decision,
    question: row.question,
    value: row.value,
    propensity: row.propensity,
    reviewer: row.reviewer,
    ...(row.locale !== undefined ? { locale: row.locale } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.tenant !== undefined ? { tenant: row.tenant } : {}),
    ...(row.score !== undefined ? { score: row.score } : {}),
    ...(row.loss !== undefined ? { loss: row.loss } : {}),
    ...(row.raw !== undefined ? { raw: row.raw } : {}),
    at: row.at,
  };
}
