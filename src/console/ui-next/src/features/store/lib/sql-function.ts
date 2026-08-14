/**
 * CREATE FUNCTION starter, templates, and preview SQL for the Functions sheet.
 */

import { quotePgIdent } from "../../../../../../drivers/pg-rls.ts";

/** Function language. */
export type SqlFunctionLanguage = "plpgsql" | "sql";

/** Optional volatility (VOLATILE is omitted from SQL). */
export type SqlFunctionVolatility = "VOLATILE" | "STABLE" | "IMMUTABLE";

/** Who the function runs as (INVOKER is omitted from SQL). */
export type SqlFunctionSecurity = "INVOKER" | "DEFINER";

/** Parallel safety (UNSAFE is omitted from SQL). */
export type SqlFunctionParallel = "UNSAFE" | "RESTRICTED" | "SAFE";

/** Fields for `CREATE FUNCTION`. */
export type SqlFunctionSpec = {
  readonly name: string;
  readonly args: string;
  readonly returns: string;
  readonly language: SqlFunctionLanguage;
  readonly volatility?: SqlFunctionVolatility;
  readonly body: string;
  readonly orReplace?: boolean;
  readonly security?: SqlFunctionSecurity;
  readonly strict?: boolean;
  readonly leakproof?: boolean;
  readonly parallel?: SqlFunctionParallel;
  readonly searchPath?: string;
  readonly cost?: number;
  readonly rows?: number;
};

/** One starter template for the New function sheet. */
export type SqlFunctionTemplate = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly returns: string;
  readonly language: SqlFunctionLanguage;
  readonly volatility?: SqlFunctionVolatility;
  readonly args?: string;
  readonly body: string;
};

/** Common Postgres function starters. */
export const SQL_FUNCTION_TEMPLATES: readonly SqlFunctionTemplate[] = [
  {
    id: "plpgsql-void",
    title: "PL/pgSQL",
    detail: "RETURNS void — empty body you fill in.",
    returns: "void",
    language: "plpgsql",
    body: "BEGIN\n  -- Write your function logic here\nEND;",
  },
  {
    id: "trigger-fn",
    title: "Trigger function",
    detail: "RETURNS trigger — use with CREATE TRIGGER.",
    returns: "trigger",
    language: "plpgsql",
    body: "BEGIN\n  RETURN NEW;\nEND;",
  },
  {
    id: "sql-scalar",
    title: "SQL scalar",
    detail: "LANGUAGE sql — a single SELECT.",
    returns: "text",
    language: "sql",
    body: "  SELECT NULL;",
  },
  {
    id: "sql-immutable",
    title: "Immutable SQL",
    detail: "LANGUAGE sql IMMUTABLE — safe for indexes.",
    returns: "text",
    language: "sql",
    volatility: "IMMUTABLE",
    body: "  SELECT $1;",
    args: "value text",
  },
];

/**
 * Pretty `CREATE FUNCTION` for the review editor.
 *
 * @param spec - Function fields
 */
export function buildCreateFunctionSql(spec: SqlFunctionSpec): string {
  const replace = spec.orReplace === true ? "OR REPLACE " : "";
  const args = isSafeFunctionClause(spec.args) ? spec.args.trim() : "";
  const returns = isSafeFunctionClause(spec.returns) ? spec.returns.trim() : "";
  const lines = [
    `CREATE ${replace}FUNCTION ${quoteFunctionName(spec.name)}(${args})`,
    `RETURNS ${returns || "void"}`,
    `LANGUAGE ${spec.language}`,
  ];
  if (spec.volatility !== undefined && spec.volatility !== "VOLATILE") {
    lines.push(spec.volatility);
  }
  if (spec.leakproof === true) lines.push("LEAKPROOF");
  if (spec.strict === true) lines.push("STRICT");
  if (spec.security === "DEFINER") lines.push("SECURITY DEFINER");
  if (spec.parallel === "RESTRICTED" || spec.parallel === "SAFE") {
    lines.push(`PARALLEL ${spec.parallel}`);
  }
  if (typeof spec.cost === "number" && Number.isFinite(spec.cost) && spec.cost > 0) {
    lines.push(`COST ${spec.cost}`);
  }
  if (typeof spec.rows === "number" && Number.isFinite(spec.rows) && spec.rows > 0) {
    lines.push(`ROWS ${spec.rows}`);
  }
  const searchPath = spec.searchPath?.trim() ?? "";
  if (searchPath !== "" && isSafeFunctionClause(searchPath)) {
    lines.push(`SET search_path TO ${searchPath}`);
  }
  lines.push("AS $$");
  const body = spec.body.replace(/^\n/, "").replace(/\n$/, "");
  lines.push(body.length > 0 ? body : defaultFunctionBody(spec.language));
  lines.push("$$;");
  return lines.join("\n");
}

/** Default body shown in the New function sheet. */
export const DEFAULT_CREATE_FUNCTION_SQL = buildCreateFunctionSql({
  name: "function_name",
  args: "",
  returns: "void",
  language: "plpgsql",
  body: "BEGIN\n  -- Write your function logic here\nEND;",
});

/**
 * True when the buffer is a CREATE FUNCTION statement (or OR REPLACE).
 *
 * @param sql - Editor buffer
 */
export function isCreateFunctionSql(sql: string): boolean {
  return /^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(sql);
}

/**
 * Body between `AS $$` and the closing `$$` of a CREATE FUNCTION buffer.
 *
 * @param sql - Editor buffer
 */
export function extractFunctionBody(sql: string): string | null {
  const match = /AS\s+\$\$\n?([\s\S]*?)\n?\$\$;?\s*$/i.exec(sql);
  return match?.[1] ?? null;
}

/**
 * True when `clause` is a single argument / return type (no statement stacking).
 *
 * @param clause - Args or RETURNS body
 */
export function isSafeFunctionClause(clause: string): boolean {
  const t = clause.trim();
  return t.length <= 2000 && !/;/.test(t) && !/--/.test(t) && !/\/\*/.test(t);
}

function defaultFunctionBody(language: SqlFunctionLanguage): string {
  return language === "sql" ? "  SELECT NULL;" : "BEGIN\n  -- Write your function logic here\nEND;";
}

/**
 * Count of Advanced function knobs that are set.
 *
 * @param spec - Function fields
 */
export function sqlFunctionAdvancedCount(
  spec: Pick<
    SqlFunctionSpec,
    "security" | "strict" | "leakproof" | "parallel" | "searchPath" | "cost" | "rows"
  >,
): number {
  return (
    (spec.security === "DEFINER" ? 1 : 0) +
    (spec.strict === true ? 1 : 0) +
    (spec.leakproof === true ? 1 : 0) +
    (spec.parallel === "RESTRICTED" || spec.parallel === "SAFE" ? 1 : 0) +
    (spec.searchPath?.trim() ? 1 : 0) +
    (typeof spec.cost === "number" && spec.cost > 0 ? 1 : 0) +
    (typeof spec.rows === "number" && spec.rows > 0 ? 1 : 0)
  );
}

function quoteFunctionName(raw: string): string {
  const name = raw.trim().replace(/\(\s*\)$/, "");
  const parts = (name.length > 0 ? name : "function_name").split(".");
  return parts.map((part) => quotePgIdent(part)).join(".");
}
