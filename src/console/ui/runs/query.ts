/**
 * Dimension query language for the Runs panel (console §9.11).
 *
 * Expression form: `flow = X AND cache = miss AND duration > 1s`
 * — analysis by dimension, not free-text search.
 */

import type { DimensionQuery, QueryClause, QueryOp, RunRecord } from "./types.ts";

const OPS: readonly QueryOp[] = ["!=", ">=", "<=", "=", ">", "<"];

/**
 * Parse a dimension query expression into clauses.
 * Invalid tokens yield an empty query (never throw from the URL).
 *
 * @param expr - Expression string
 */
export function parseDimensionQuery(expr: string | undefined | null): DimensionQuery {
  if (!expr || !expr.trim()) return { clauses: [] };
  const parts = expr
    .split(/\s+AND\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const clauses: QueryClause[] = [];
  for (const part of parts) {
    const clause = parseClause(part);
    if (clause) clauses.push(clause);
  }
  return { clauses };
}

/**
 * Serialise clauses back to expression syntax.
 *
 * @param query - Parsed query
 */
export function serializeDimensionQuery(query: DimensionQuery): string {
  return query.clauses.map(formatClause).join(" AND ");
}

/**
 * Append one clause (or replace same dimension).
 *
 * @param query - Current query
 * @param clause - Clause to add
 */
export function upsertClause(query: DimensionQuery, clause: QueryClause): DimensionQuery {
  const rest = query.clauses.filter((c) => c.dimension !== clause.dimension);
  return { clauses: [...rest, clause] };
}

/**
 * Remove a dimension from the query.
 *
 * @param query - Current query
 * @param dimension - Dimension name
 */
export function removeClause(query: DimensionQuery, dimension: string): DimensionQuery {
  return {
    clauses: query.clauses.filter((c) => c.dimension !== dimension),
  };
}

/**
 * Whether a run matches every clause.
 *
 * @param run - Wide-event projection
 * @param query - Dimension query
 */
export function matchesDimensionQuery(run: RunRecord, query: DimensionQuery): boolean {
  for (const clause of query.clauses) {
    if (!matchClause(run, clause)) return false;
  }
  return true;
}

/**
 * Filter a population by the dimension query.
 *
 * @param runs - All runs
 * @param query - Dimension query
 */
export function filterRuns(runs: readonly RunRecord[], query: DimensionQuery): RunRecord[] {
  if (query.clauses.length === 0) return [...runs];
  return runs.filter((r) => matchesDimensionQuery(r, query));
}

/**
 * Format a single clause for display / URL.
 *
 * @param clause - Clause
 */
export function formatClause(clause: QueryClause): string {
  const v = formatValue(clause.dimension, clause.value);
  return `${clause.dimension} ${clause.op} ${v}`;
}

/**
 * Common dimensions offered by the builder (others remain typed).
 */
export const BUILDER_DIMENSIONS = [
  "flow",
  "unit",
  "trigger",
  "plane",
  "tenant",
  "principal",
  "cache",
  "replica",
  "error",
  "buildVersion",
  "promptVersion",
  "duration",
] as const;

function parseClause(raw: string): QueryClause | null {
  let op: QueryOp | null = null;
  let opAt = -1;
  for (const candidate of OPS) {
    const idx = raw.indexOf(` ${candidate} `);
    if (idx === -1) continue;
    // Prefer longer ops already ordered first.
    op = candidate;
    opAt = idx;
    break;
  }
  if (op === null || opAt < 0) return null;
  const dimension = raw.slice(0, opAt).trim();
  const valueRaw = raw.slice(opAt + op.length + 2).trim();
  if (!dimension || !valueRaw) return null;
  const value = parseValue(dimension, valueRaw);
  if (value === undefined) return null;
  return { dimension, op, value };
}

function parseValue(dimension: string, raw: string): string | number | boolean | undefined {
  if (dimension === "duration" || dimension === "duration_ms") {
    return parseDurationMs(raw);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Parse a duration literal (`1s`, `200ms`, `2m`, bare number = ms).
 *
 * @param raw - Literal
 */
export function parseDurationMs(raw: string): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(raw.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60_000;
  return undefined;
}

function formatValue(dimension: string, value: string | number | boolean): string {
  if (dimension === "duration" || dimension === "duration_ms") {
    const ms = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(ms)) return String(value);
    if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
    if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
    return `${ms}ms`;
  }
  if (typeof value === "string" && /\s/.test(value)) return `"${value}"`;
  return String(value);
}

function matchClause(run: RunRecord, clause: QueryClause): boolean {
  const left = dimensionValue(run, clause.dimension);
  if (left === undefined || left === null) {
    return clause.op === "!=";
  }
  const right = clause.value;
  if (clause.op === "=") return compareEq(left, right);
  if (clause.op === "!=") return !compareEq(left, right);
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (ln === undefined || rn === undefined) return false;
  if (clause.op === ">") return ln > rn;
  if (clause.op === "<") return ln < rn;
  if (clause.op === ">=") return ln >= rn;
  if (clause.op === "<=") return ln <= rn;
  return false;
}

/**
 * Resolve a dimension from top-level fields or `dimensions`.
 *
 * @param run - Run record
 * @param name - Dimension name
 */
export function dimensionValue(
  run: RunRecord,
  name: string,
): string | number | boolean | null | undefined {
  switch (name) {
    case "flow":
      return run.flow;
    case "unit":
      return run.unit ?? null;
    case "trigger":
      return run.trigger;
    case "plane":
      return run.plane;
    case "tenant":
      return run.tenant ?? null;
    case "principal":
      return run.principal ?? null;
    case "cache":
      return run.cache;
    case "replica":
      return run.replica ?? null;
    case "replicaLagMs":
    case "replica_lag_ms":
      return run.replicaLagMs ?? null;
    case "error":
    case "error_code":
      return run.error ?? null;
    case "buildVersion":
    case "build_version":
      return run.buildVersion ?? null;
    case "promptVersion":
    case "prompt_version":
      return run.promptVersion ?? null;
    case "cost":
      return run.cost ?? null;
    case "duration":
    case "duration_ms":
      return run.durationMs;
    case "gates":
      return run.gates.join(",");
    default:
      return run.dimensions[name];
  }
}

function compareEq(left: string | number | boolean, right: string | number | boolean): boolean {
  if (typeof left === "number" || typeof right === "number") {
    const ln = toNumber(left);
    const rn = toNumber(right);
    if (ln !== undefined && rn !== undefined) return ln === rn;
  }
  return String(left) === String(right);
}

function toNumber(v: string | number | boolean): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
