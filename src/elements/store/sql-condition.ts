/**
 * Compile Drizzle SQL operators (`eq`, `and`, `or`, `lt`, `like`, …) and plain
 * equality maps into `WHERE` SQL + bound params for {@link SqlConnection}.
 *
 * Table-agnostic query-builder support — not domain helpers.
 */

/** Equality map for where clauses (`{ code: "sa" }`). */
export type WhereMap = Readonly<Record<string, unknown>>;

/** One compiled predicate (`col op ?`). */
export interface CompiledPredicate {
  readonly column: string;
  readonly op:
    | "="
    | "<"
    | ">"
    | "<="
    | ">="
    | "!="
    | "like"
    | "ilike"
    | "in"
    | "is null"
    | "is not null";
  readonly value: unknown;
}

/** Compiled WHERE clause. */
export interface CompiledWhere {
  readonly clause: string;
  readonly params: readonly unknown[];
  readonly predicates: readonly CompiledPredicate[];
}

/** One compiled `ORDER BY` term. */
export interface CompiledOrder {
  readonly column: string;
  readonly direction: "ASC" | "DESC";
}

/** Intermediate compiled node — a leaf comparison or a joined group. */
interface CompiledNode {
  readonly clause: string;
  readonly params: readonly unknown[];
  readonly predicates: readonly CompiledPredicate[];
}

const EMPTY_NODE: CompiledNode = { clause: "", params: [], predicates: [] };

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

/** Marker for {@link andWhere} — avoids importing `drizzle-orm` here. */
export interface AndCondition {
  readonly [andConditionBrand]: true;
  readonly conditions: readonly unknown[];
}
const andConditionBrand: unique symbol = Symbol("oke.and");

/**
 * Join conditions with `AND` without importing `drizzle-orm`.
 * `undefined` entries are dropped; a single remaining condition compiles
 * bare.
 *
 * @param conditions - Equality maps or Drizzle SQL
 */
export function andWhere(...conditions: readonly unknown[]): unknown {
  const kept = conditions.filter((c) => c !== undefined && c !== null);
  if (kept.length === 1) return kept[0];
  return { [andConditionBrand]: true, conditions: kept } satisfies AndCondition;
}

/**
 * Compile a where input into SQL.
 *
 * Accepts:
 * - plain {@link WhereMap} equality maps
 * - Drizzle `SQL` from `eq` / `and` / `or` / `lt` / `like` / …
 * - {@link AndCondition} from {@link andWhere}
 *
 * Nested `and(...)` / `or(...)` compile to parenthesized groups — `or` is
 * never flattened into `AND`. Unsupported operators throw rather than
 * silently dropping predicates.
 *
 * @param where - Condition
 */
export function compileWhere(where: unknown): CompiledWhere {
  if (where === undefined || where === null) {
    return { clause: "", params: [], predicates: [] };
  }

  if (isDrizzleSql(where)) {
    const node = compileSqlNode(where);
    return { clause: node.clause, params: node.params, predicates: node.predicates };
  }

  if (isAndCondition(where)) {
    const children = where.conditions.map(compileWhere).filter((c) => c.clause !== "");
    if (children.length === 0) return { clause: "", params: [], predicates: [] };
    if (children.length === 1) return children[0]!;
    return {
      clause: children.map((c) => `(${c.clause})`).join(" AND "),
      params: children.flatMap((c) => c.params),
      predicates: children.flatMap((c) => c.predicates),
    };
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

function isAndCondition(value: unknown): value is AndCondition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as AndCondition)[andConditionBrand] === true
  );
}

/**
 * Compile Drizzle `asc()` / `desc()` terms into `ORDER BY` entries.
 * Bare column references default to `ASC`.
 *
 * @param orders - Order terms (`asc(col)` / `desc(col)` SQL or columns)
 */
export function compileOrderBy(orders: readonly unknown[]): readonly CompiledOrder[] {
  return orders.map((order) => {
    if (isDrizzleSql(order)) {
      let column: string | undefined;
      let text = "";
      for (const chunk of chunksOf(order)) {
        if (isDrizzleSql(chunk)) {
          throw new TypeError("orderBy(): nested SQL is not supported");
        }
        const chunkString = chunkText(chunk);
        if (chunkString !== undefined) {
          text += chunkString;
          continue;
        }
        const col = asColumn(chunk);
        if (col === undefined) {
          throw new TypeError("orderBy(): expected drizzle asc()/desc() SQL");
        }
        if (column !== undefined) {
          throw new TypeError("orderBy(): one column per term");
        }
        column = col;
      }
      if (column === undefined) {
        throw new TypeError("orderBy(): expected drizzle asc()/desc() SQL");
      }
      const dir = text.trim().toLowerCase();
      if (dir === "" || dir === "asc") return { column, direction: "ASC" } as const;
      if (dir === "desc") return { column, direction: "DESC" } as const;
      throw new TypeError(`orderBy(): unsupported direction ${JSON.stringify(text.trim())}`);
    }
    const col = asColumn(order);
    if (col !== undefined) return { column: col, direction: "ASC" } as const;
    throw new TypeError("orderBy(): expected drizzle asc()/desc() SQL or a column");
  });
}

/**
 * Turn predicates into `col = ? AND …` form (plain equality maps only).
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
 * Recursively compile one Drizzle `SQL` node. Nodes with nested `SQL`
 * children are groups joined by `AND` / `OR` (detected from the separator
 * chunks Drizzle emits); nodes without are leaf comparisons.
 *
 * @param node - Drizzle SQL wrapper
 */
function compileSqlNode(node: unknown): CompiledNode {
  const chunks = chunksOf(node);
  const nested = chunks.filter(isDrizzleSql);

  if (nested.length === 0) {
    return compileLeaf(chunks);
  }

  // Group level: only structural parens and ` and ` / ` or ` separators may
  // appear next to nested conditions — anything else is a loud failure.
  let joiner: "AND" | "OR" | undefined;
  for (const chunk of chunks) {
    if (isDrizzleSql(chunk)) continue;
    const text = chunkText(chunk);
    if (text === undefined) {
      throw new TypeError("sql where: unsupported mixed condition");
    }
    const token = text.trim().toLowerCase();
    if (token === "" || token === "(" || token === ")") continue;
    if (token === "and" || token === "or") {
      const next = token.toUpperCase() as "AND" | "OR";
      if (joiner !== undefined && joiner !== next) {
        throw new TypeError("sql where: mixed AND/OR at one level — parenthesize explicitly");
      }
      joiner = next;
      continue;
    }
    throw new TypeError(`sql where: unsupported fragment ${JSON.stringify(text)}`);
  }

  const children = nested.map(compileSqlNode).filter((c) => c.clause !== "");
  if (children.length === 0) return EMPTY_NODE;
  if (children.length === 1) return children[0] ?? EMPTY_NODE;
  const sep = joiner ?? "AND";
  return {
    clause: children.map((c) => `(${c.clause})`).join(` ${sep} `),
    params: children.flatMap((c) => c.params),
    predicates: children.flatMap((c) => c.predicates),
  };
}

/**
 * Compile a leaf node (`col op ?`) from chunks with no nested `SQL`.
 * Structural paren chunks are ignored; every other chunk must be part of the
 * comparison or it throws. `is null` / `is not null` bind no value; `in`
 * binds one placeholder per array element.
 *
 * @param chunks - Drizzle query chunks
 */
function compileLeaf(chunks: readonly unknown[]): CompiledNode {
  let column: string | undefined;
  let op: CompiledPredicate["op"] | undefined;
  let value: unknown;
  let state: "start" | "column" | "op" | "done" = "start";

  for (const chunk of chunks) {
    if (Array.isArray(chunk)) {
      if (state !== "op" || op !== "in") {
        throw new TypeError("sql where: unsupported condition shape");
      }
      const values = chunk.map(asInArrayValue);
      value = values;
      state = "done";
      continue;
    }
    const text = chunkText(chunk);
    if (text !== undefined) {
      const token = text.trim().replace(/\)+$/, "");
      if (token === "" || token === "(" || token === ")") continue;
      if (state === "column") {
        op = asOperator(token);
        if (op === undefined) {
          throw new TypeError(`sql where: unsupported operator ${JSON.stringify(token)}`);
        }
        state = op === "is null" || op === "is not null" ? "done" : "op";
        continue;
      }
      throw new TypeError(`sql where: unsupported fragment ${JSON.stringify(text)}`);
    }
    const col = asColumn(chunk);
    if (col !== undefined) {
      if (state !== "start") {
        throw new TypeError("sql where: unsupported condition shape");
      }
      column = col;
      state = "column";
      continue;
    }
    const param = asParamValue(chunk);
    if (param.found) {
      if (state !== "op") {
        throw new TypeError("sql where: unsupported condition shape");
      }
      value = param.value;
      state = "done";
      continue;
    }
    throw new TypeError("sql where: unsupported condition chunk");
  }

  if (state === "start") return EMPTY_NODE;
  if (state !== "done" || column === undefined || op === undefined) {
    throw new TypeError("sql where: incomplete condition");
  }
  const predicate: CompiledPredicate = { column, op, value };
  if (op === "is null" || op === "is not null") {
    return { clause: `${quoteIdent(column)} ${op}`, params: [], predicates: [predicate] };
  }
  if (op === "in") {
    const values = value as readonly unknown[];
    const placeholders = values.map(() => "?").join(", ");
    return {
      clause: `${quoteIdent(column)} in (${placeholders})`,
      params: [...values],
      predicates: [predicate],
    };
  }
  return {
    clause: `${quoteIdent(column)} ${op} ?`,
    params: [value],
    predicates: [predicate],
  };
}

function chunksOf(node: unknown): readonly unknown[] {
  return (node as { queryChunks: unknown[] }).queryChunks;
}

/**
 * True when `chunk` is a Drizzle `StringChunk` (or the synthetic array-valued
 * shape `resource.ts` still emits). `Param` also has a `value` field — never
 * treat those as SQL text.
 */
function isStringChunk(chunk: object): boolean {
  const ctor = (chunk as { constructor?: { name?: unknown } }).constructor?.name;
  if (ctor === "StringChunk") return true;
  const value = (chunk as { value?: unknown }).value;
  return (
    Array.isArray(value) &&
    value.every((part) => typeof part === "string") &&
    !("encoder" in chunk) &&
    !("name" in chunk)
  );
}

/**
 * Joined text of a Drizzle `StringChunk`.
 *
 * drizzle-orm `1.0.0-rc.5-169397b` stores `value` as a `string`. Earlier
 * snapshots (and the synthetic chunks in `resource.ts`) store `string[]`.
 */
function chunkText(chunk: unknown): string | undefined {
  if (!chunk || typeof chunk !== "object" || !isStringChunk(chunk)) return undefined;
  const value = (chunk as { value?: unknown }).value;
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.join("") : undefined;
}

function asColumn(chunk: unknown): string | undefined {
  if (!chunk || typeof chunk !== "object") return undefined;
  const name = (chunk as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function asOperator(token: string): CompiledPredicate["op"] | undefined {
  switch (token.toLowerCase()) {
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
    case "like":
      return "like";
    case "ilike":
      return "ilike";
    case "in":
      return "in";
    case "is null":
      return "is null";
    case "is not null":
      return "is not null";
    default:
      return undefined;
  }
}

/** Unwrap one element of a Drizzle `inArray` value array. */
function asInArrayValue(item: unknown): unknown {
  const param = asParamValue(item);
  if (!param.found) {
    throw new TypeError("sql where: unsupported in-list value");
  }
  return param.value;
}

/**
 * Param values arrive either as Drizzle `Param` instances (wrapped by
 * `bindIfParam`) or as raw primitives interpolated by `sql` templates
 * (`like`, `ilike`, …).
 */
function asParamValue(chunk: unknown): { readonly found: boolean; readonly value?: unknown } {
  if (chunk === undefined) return { found: false };
  if (chunk === null || typeof chunk !== "object") return { found: true, value: chunk };
  if (Array.isArray(chunk)) return { found: false };
  if (isStringChunk(chunk)) return { found: false };
  if (!("value" in (chunk as object))) return { found: false };
  if (Array.isArray((chunk as { value: unknown }).value)) return { found: false };
  if ((chunk as { name?: unknown }).name) return { found: false };
  return { found: true, value: (chunk as { value: unknown }).value };
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
