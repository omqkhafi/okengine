/**
 * Compile Drizzle SQL operators (`eq`, `and`, `lt`, …) and plain equality
 * maps into `WHERE` SQL + bound params for {@link SqlConnection}.
 *
 * Table-agnostic query-builder support — not domain helpers.
 */

/** Equality map for where clauses (`{ code: "sa" }`). */
export type WhereMap = Readonly<Record<string, unknown>>;

/** One compiled predicate (`col op ?`). */
export interface CompiledPredicate {
  readonly column: string;
  readonly op: "=" | "<" | ">" | "<=" | ">=" | "!=";
  readonly value: unknown;
}

/** Compiled WHERE clause. */
export interface CompiledWhere {
  readonly clause: string;
  readonly params: readonly unknown[];
  readonly predicates: readonly CompiledPredicate[];
}

/**
 * True when `value` looks like a Drizzle `SQL` wrapper (`eq` / `and` / …).
 *
 * @param value - Unknown condition
 */
export function isDrizzleSql(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { queryChunks?: unknown }).queryChunks)
  );
}

/**
 * Compile a where input into SQL.
 *
 * Accepts:
 * - plain {@link WhereMap} equality maps
 * - Drizzle `SQL` from `eq` / `and` / `lt` / …
 *
 * @param where - Condition
 */
export function compileWhere(where: unknown): CompiledWhere {
  if (where === undefined || where === null) {
    return { clause: "", params: [], predicates: [] };
  }

  if (isDrizzleSql(where)) {
    const predicates = extractPredicates(where);
    return predicatesToWhere(predicates);
  }

  if (typeof where === "object" && !Array.isArray(where)) {
    const predicates: CompiledPredicate[] = Object.entries(where as WhereMap).map(
      ([column, value]) => ({
        column,
        op: "=" as const,
        value,
      }),
    );
    return predicatesToWhere(predicates);
  }

  throw new TypeError("sql where: expected equality map or Drizzle SQL condition");
}

/**
 * Turn predicates into `col = ? AND …` form.
 *
 * @param predicates - Ordered predicates
 */
function predicatesToWhere(predicates: readonly CompiledPredicate[]): CompiledWhere {
  if (predicates.length === 0) {
    return { clause: "", params: [], predicates: [] };
  }
  const clause = predicates.map((p) => `${quoteIdent(p.column)} ${p.op} ?`).join(" AND ");
  return {
    clause,
    params: predicates.map((p) => p.value),
    predicates,
  };
}

/**
 * Walk Drizzle `queryChunks` and collect simple binary comparisons.
 *
 * @param node - Drizzle SQL or nested chunk
 */
function extractPredicates(node: unknown): CompiledPredicate[] {
  const out: CompiledPredicate[] = [];
  walk(node, out);
  return out;
}

function walk(node: unknown, out: CompiledPredicate[]): void {
  if (!node || typeof node !== "object") return;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return;

  // Flatten nested SQL wrappers first so we can scan for col / op / param.
  const flat: unknown[] = [];
  for (const c of chunks) {
    if (c && typeof c === "object" && "queryChunks" in (c as object)) {
      walk(c, out);
    } else {
      flat.push(c);
    }
  }

  for (let i = 0; i < flat.length; i++) {
    const col = asColumn(flat[i]);
    if (!col) continue;
    const op = asOperator(flat[i + 1]);
    if (!op) continue;
    const param = asParam(flat[i + 2]);
    if (param === undefined) continue;
    out.push({ column: col, op, value: param });
    i += 2;
  }
}

function asColumn(chunk: unknown): string | undefined {
  if (!chunk || typeof chunk !== "object") return undefined;
  const name = (chunk as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function asOperator(chunk: unknown): CompiledPredicate["op"] | undefined {
  if (!chunk || typeof chunk !== "object") return undefined;
  const value = (chunk as { value?: unknown }).value;
  const text = Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "";
  const trimmed = text.trim();
  switch (trimmed) {
    case "=":
      return "=";
    case "<":
      return "<";
    case ">":
      return ">";
    case "<=":
      return "<=";
    case ">=":
      return ">=";
    case "!=":
    case "<>":
      return "!=";
    default:
      return undefined;
  }
}

function asParam(chunk: unknown): unknown {
  if (!chunk || typeof chunk !== "object") return undefined;
  if (!("value" in (chunk as object))) return undefined;
  // StringChunk also has `.value` (array of strings) — skip those.
  if (Array.isArray((chunk as { value: unknown }).value)) return undefined;
  if ((chunk as { name?: unknown }).name) return undefined;
  return (chunk as { value: unknown }).value;
}

/**
 * Resolve select-projection keys → SQL column names from Drizzle columns.
 *
 * @param columns - `{ alias: table.col }` or undefined for `*`
 */
export function resolveSelectColumns(
  columns: unknown,
): ReadonlyArray<{ readonly alias: string; readonly sqlName: string }> | null {
  if (columns === undefined || columns === null) return null;
  if (typeof columns !== "object" || Array.isArray(columns)) {
    throw new TypeError("select(): expected a column map");
  }
  const out: Array<{ alias: string; sqlName: string }> = [];
  for (const [alias, col] of Object.entries(columns as Record<string, unknown>)) {
    if (col && typeof col === "object" && typeof (col as { name?: unknown }).name === "string") {
      out.push({ alias, sqlName: (col as { name: string }).name });
    } else if (typeof col === "string") {
      out.push({ alias, sqlName: col });
    } else {
      throw new TypeError(`select(): invalid column for ${JSON.stringify(alias)}`);
    }
  }
  return out;
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}
