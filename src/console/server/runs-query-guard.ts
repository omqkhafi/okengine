/**
 * Read-only statement guard for Console `POST /console/runs/query`.
 *
 * First-token checks are not enough (DuckDB FROM-first, CTE-wrapped DML).
 * This scans unquoted, comment-stripped text and rejects writes / external access.
 */

/** Named PII limitation for free-form SELECT output. */
export const RUNS_QUERY_PII_GAP = "RunsQueryPiiProjectionGap" as const;

/** Hard result ceiling (also injected as LIMIT on unbounded SELECT/FROM). */
export const RUNS_QUERY_ROW_LIMIT = 1_000;

/** Wall-clock timeout for a Console runs query. */
export const RUNS_QUERY_TIMEOUT_MS = 5_000;

/** Accepted first keywords after comment strip. */
const ALLOWED_HEADS = new Set([
  "SELECT",
  "WITH",
  "EXPLAIN",
  "DESCRIBE",
  "SUMMARIZE",
  "FROM",
  "PIVOT",
  "UNPIVOT",
  "TABLE",
]);

/** Write / session / extension keywords — rejected in the unquoted body. */
const FORBIDDEN_WORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "COPY",
  "MERGE",
  "CALL",
  "GRANT",
  "REVOKE",
  "VACUUM",
  "COMMENT",
  "REFRESH",
  "INSTALL",
  "LOAD",
  "ATTACH",
  "DETACH",
  "EXPORT",
  "IMPORT",
  "PRAGMA",
  "SET",
  "RESET",
  "ANALYZE",
  "CHECKPOINT",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
]);

/** DuckDB filesystem / extension entry points. */
const EXTERNAL_FNS = [
  "read_csv",
  "read_csv_auto",
  "read_json",
  "read_json_auto",
  "read_json_objects",
  "read_ndjson",
  "read_parquet",
  "read_text",
  "read_blob",
  "read_xlsx",
  "httpfs",
  "copy_database",
];

/** Successful guard — SQL ready to execute (LIMIT may be injected). */
export interface RunsQueryGuardOk {
  readonly ok: true;
  readonly sql: string;
  readonly injectedLimit: boolean;
}

/** Rejected statement. */
export interface RunsQueryGuardReject {
  readonly ok: false;
  readonly reason: string;
}

/** Result of {@link guardRunsQuerySql}. */
export type RunsQueryGuardResult = RunsQueryGuardOk | RunsQueryGuardReject;

/**
 * Validate operator SQL for the runs query console.
 *
 * @param sql - Raw editor buffer
 */
export function guardRunsQuerySql(sql: string): RunsQueryGuardResult {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return reject("empty");

  const statements = splitUnquotedStatements(trimmed);
  if (statements.length === 0) return reject("empty");
  if (statements.length > 1) return reject("multi-statement");

  const statement = statements[0]!;
  const unquoted = unquotedText(statement);
  const stripped = stripSqlComments(unquoted).replace(/\s+/g, " ").trim();
  if (stripped.length === 0) return reject("empty");

  const head = leadingKeyword(stripped);
  if (head === "EXPLAIN" && /\bANALYZE\b/i.test(stripped)) {
    return reject("explain-analyze");
  }
  if (!ALLOWED_HEADS.has(head)) return reject(`head:${head || "unknown"}`);

  const words = stripped.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g) ?? [];
  for (const word of words) {
    if (FORBIDDEN_WORDS.has(word)) return reject(`keyword:${word.toLowerCase()}`);
  }

  const lower = stripped.toLowerCase();
  for (const fn of EXTERNAL_FNS) {
    if (lower.includes(fn)) return reject(`external:${fn}`);
  }

  const inject =
    (head === "SELECT" || head === "FROM" || head === "WITH" || head === "TABLE") &&
    !/\bLIMIT\b/i.test(stripped);
  const prepared = inject
    ? `${statement.replace(/;+\s*$/, "")} LIMIT ${RUNS_QUERY_ROW_LIMIT}`
    : statement;
  return { ok: true, sql: prepared, injectedLimit: inject };
}

function reject(reason: string): RunsQueryGuardReject {
  return { ok: false, reason };
}

function leadingKeyword(sql: string): string {
  const match = /^([A-Za-z]+)/.exec(sql);
  return match?.[1]?.toUpperCase() ?? "";
}

function splitUnquotedStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === ";") {
      const part = sql.slice(start, i).trim();
      if (part.replace(/;+/g, "").trim().length > 0) out.push(part);
      start = i + 1;
    }
  }
  const tail = sql
    .slice(start)
    .trim()
    .replace(/;+\s*$/, "");
  if (tail.length > 0) out.push(tail);
  return out;
}

function unquotedText(sql: string): string {
  let out = "";
  let quote: "'" | '"' | "`" | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripSqlComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += sql[i];
  }
  return out;
}
