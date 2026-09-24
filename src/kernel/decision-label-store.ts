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
import type { DecisionCandidate, DecisionLabel } from "../elements/ai/decisions/certificate.ts";

/** SQL surface the postgres journal client already exposes. */
export interface DecisionLabelSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/** Drift for one decision. A later certificate (`certifiedAt` newer) ignores it. */
export interface DecisionDriftFlag {
  readonly suspended: boolean;
  /** Epoch ms of the certificate that was current when the flag was written. */
  readonly certifiedAt: number;
}

/** @deprecated Use {@link DecisionDriftFlag}. Kept for stored rows. */
export interface DecisionDriftRecord extends DecisionDriftFlag {}

/** Thrown when the postgres label store cannot open or query. */
export class DecisionLabelStoreError extends Error {
  /**
   * @param message - What failed
   * @param options - Underlying driver error
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecisionLabelStoreError";
  }
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
  /** Drift flags keyed by decision name. */
  drift(): Promise<Readonly<Record<string, DecisionDriftFlag>>>;
  /**
   * Persist one decision's suspension flag.
   *
   * @param decision - Decision name
   * @param record - Flag and the certificate time it belongs to
   */
  setDrift(decision: string, record: DecisionDriftFlag): Promise<void>;
  /**
   * Store one candidate on this journal. Any instance can read it after a restart.
   *
   * @param decision - Decision name
   * @param entry - Lock entry the clock fitted
   */
  putCandidate(decision: string, entry: DecisionCandidate): Promise<void>;
  /**
   * Candidate last written for this decision.
   *
   * @param decision - Decision name
   */
  getCandidate(decision: string): Promise<DecisionCandidate | undefined>;
  /** Decision names that have a candidate. */
  listCandidates(): Promise<readonly string[]>;
}

interface StoredLabel extends DecisionLabel {
  readonly at: number;
}

/**
 * In-memory label store.
 */
export function createMemoryDecisionLabelStore(): DecisionLabelStore {
  const rows: StoredLabel[] = [];
  const candidates = new Map<string, DecisionCandidate>();
  const driftFlags = new Map<string, DecisionDriftFlag>();
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
      return Object.fromEntries(driftFlags);
    },
    async setDrift(decision, next) {
      if (next.suspended) driftFlags.set(decision, next);
      else driftFlags.delete(decision);
    },
    async putCandidate(decision, entry) {
      candidates.set(decision, entry);
    },
    async getCandidate(decision) {
      return candidates.get(decision);
    },
    async listCandidates() {
      return [...candidates.keys()];
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
  let candidates: Record<string, DecisionCandidate> = {};
  let driftFlags: Record<string, DecisionDriftFlag> = {};
  const load = async (): Promise<void> => {
    if (rows) return;
    rows = [];
    const file = Bun.file(path);
    if (await file.exists()) {
      const raw = (await file.json()) as {
        rows?: StoredLabel[];
        suspended?: boolean;
        certifiedAt?: number;
        drifts?: Record<string, DecisionDriftFlag>;
        candidates?: Record<string, DecisionCandidate>;
      };
      rows = raw.rows ?? [];
      candidates = raw.candidates ?? {};
      driftFlags = raw.drifts ?? {};
      if (raw.suspended === true && Object.keys(driftFlags).length === 0) {
        driftFlags = { "*": { suspended: true, certifiedAt: raw.certifiedAt ?? 0 } };
      }
    }
  };
  const flush = async (): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(
      path,
      JSON.stringify({
        rows,
        candidates,
        drifts: driftFlags,
      }),
    );
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
      return driftFlags;
    },
    async setDrift(decision, next) {
      await load();
      if (next.suspended) driftFlags[decision] = next;
      else delete driftFlags[decision];
      await flush();
    },
    async putCandidate(decision, entry) {
      await load();
      candidates[decision] = entry;
      await flush();
    },
    async getCandidate(decision) {
      await load();
      return candidates[decision];
    },
    async listCandidates() {
      await load();
      return Object.keys(candidates);
    },
  };
}

/** Decision names an old app-wide drift flag is copied onto. Boot sets this before open. */
let declaredDriftDecisions: readonly string[] = [];

/**
 * Declare which decisions receive a legacy app-wide drift flag.
 *
 * @param names - Decision names from the manifest
 */
export function setDeclaredDriftDecisions(names: readonly string[]): void {
  declaredDriftDecisions = names;
}

/**
 * Postgres label store on the journal connection. Creates the tables.
 * A failed init or query throws {@link DecisionLabelStoreError}.
 *
 * @param sql - Journal SQL client
 */
export async function createPostgresDecisionLabelStore(
  sql: DecisionLabelSql,
): Promise<DecisionLabelStore> {
  try {
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
      at BIGINT NOT NULL,
      input TEXT
    )`);
    await sql.exec(`ALTER TABLE oke_decision_labels ADD COLUMN IF NOT EXISTS input TEXT`);
    await sql.exec(`ALTER TABLE oke_decision_labels ADD COLUMN IF NOT EXISTS review_id TEXT`);
    await migrateDecisionDriftTable(sql, declaredDriftDecisions);
    await sql.exec(`CREATE TABLE IF NOT EXISTS oke_decision_candidates (
      decision_id TEXT PRIMARY KEY,
      body TEXT NOT NULL
    )`);
  } catch (cause) {
    throw new DecisionLabelStoreError("decision label store failed to open", { cause });
  }
  const query = async (
    statement: string,
    params?: readonly unknown[],
  ): Promise<Record<string, unknown>[]> => {
    try {
      return await sql.query(statement, params);
    } catch (cause) {
      throw new DecisionLabelStoreError("decision label store query failed", { cause });
    }
  };
  const exec = async (statement: string, params?: readonly unknown[]): Promise<void> => {
    try {
      await sql.exec(statement, params);
    } catch (cause) {
      throw new DecisionLabelStoreError("decision label store query failed", { cause });
    }
  };
  return {
    async insert(label, at) {
      await exec(
        `INSERT INTO oke_decision_labels
          (decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss, raw, at, input, review_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          label.input === undefined ? null : JSON.stringify(label.input),
          label.reviewId ?? null,
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
        clauses.push("tenant IS NOT DISTINCT FROM ?");
        args.push(tenant);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const found = await query(
        `SELECT decision_id, question, value, propensity, reviewer, locale, model, tenant, score, loss, raw, at, input, review_id
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
        ...(row.input != null ? { input: JSON.parse(String(row.input)) as unknown } : {}),
        ...(row.review_id != null ? { reviewId: String(row.review_id) } : {}),
        at: Number(row.at),
      }));
    },
    async drift() {
      const rows = await query(
        `SELECT decision_id, suspended, certified_at FROM oke_decision_drift`,
      );
      const flags: Record<string, DecisionDriftFlag> = {};
      for (const row of rows) {
        const name = String(row.decision_id ?? "");
        if (!name) continue;
        flags[name] = {
          suspended: Number(row.suspended) === 1,
          certifiedAt: Number(row.certified_at ?? 0),
        };
      }
      return flags;
    },
    async setDrift(decision, next) {
      if (!next.suspended) {
        await exec(`DELETE FROM oke_decision_drift WHERE decision_id = ?`, [decision]);
        return;
      }
      await exec(
        `INSERT INTO oke_decision_drift (decision_id, suspended, certified_at) VALUES (?, ?, ?)
         ON CONFLICT (decision_id) DO UPDATE SET suspended = excluded.suspended, certified_at = excluded.certified_at`,
        [decision, 1, next.certifiedAt],
      );
    },
    async putCandidate(decision, entry) {
      await exec(
        `INSERT INTO oke_decision_candidates (decision_id, body) VALUES (?, ?)
         ON CONFLICT (decision_id) DO UPDATE SET body = excluded.body`,
        [decision, JSON.stringify(entry)],
      );
    },
    async getCandidate(decision) {
      const rows = await query(`SELECT body FROM oke_decision_candidates WHERE decision_id = ?`, [
        decision,
      ]);
      const body = rows[0]?.body;
      if (typeof body !== "string") return undefined;
      const parsed = JSON.parse(body) as DecisionCandidate;
      if (!parsed || typeof parsed.model !== "string" || !parsed.questions) return undefined;
      return parsed;
    },
    async listCandidates() {
      const rows = await query(`SELECT decision_id FROM oke_decision_candidates`);
      return rows.map((row) => String(row.decision_id));
    },
  };
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
    ...(row.input !== undefined ? { input: row.input } : {}),
    ...(row.reviewId !== undefined ? { reviewId: row.reviewId } : {}),
    at: row.at,
  };
}

/**
 * Recreate `oke_decision_drift` when it still uses an app-wide `id` row.
 * A suspended flag is copied onto every declared decision.
 *
 * @param sql - Journal SQL client
 * @param names - Declared decision names
 */
async function migrateDecisionDriftTable(
  sql: DecisionLabelSql,
  names: readonly string[],
): Promise<void> {
  const create = `CREATE TABLE IF NOT EXISTS oke_decision_drift (
      decision_id TEXT PRIMARY KEY,
      suspended INTEGER NOT NULL,
      certified_at BIGINT NOT NULL
    )`;
  let columns: string[] = [];
  try {
    const rows = await sql.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'oke_decision_drift'`,
    );
    columns = rows.map((row) => String(row.column_name ?? "").toLowerCase());
  } catch {
    columns = [];
  }
  if (columns.includes("id") && !columns.includes("decision_id")) {
    const old = await sql.query(`SELECT * FROM oke_decision_drift`);
    const flag = old[0];
    await sql.exec(`DROP TABLE oke_decision_drift`);
    await sql.exec(create.replace("IF NOT EXISTS ", ""));
    if (flag && Number(flag.suspended) === 1) {
      const certifiedAt = Number(flag.certified_at ?? 0);
      for (const name of names) {
        await sql.exec(
          `INSERT INTO oke_decision_drift (decision_id, suspended, certified_at) VALUES (?, ?, ?)`,
          [name, 1, certifiedAt],
        );
      }
    }
    return;
  }
  await sql.exec(create);
}
