/**
 * The PostgREST-shaped list grammar — URL parsing and page compilation,
 * table-agnostic and factory-independent.
 *
 * Extracted verbatim from the `store.resource` factory closure so any
 * surface (resource lists, live query windows, hand-written flows via
 * `liveQuery`) parses the exact same grammar. Every config knob is
 * whitelisted by a ColumnScope (`"all" | Column[] | "none"`), applied at
 * {@link resolveListScope} time.
 *
 * List URL (UTF-8 values — English, Arabic, …):
 * `?cursor=` / `?offset=` / `?limit=` · `?search=` (`?q=` alias) ·
 * `?col=eq.x|neq|gt|gte|lt|lte|like.*p*|ilike.*p*|in.(a,b)|is.null|not_null|true|false` ·
 * `?col=not.eq.x` · `?or=(…)` / `?and=(…)` (nested `not.and` / `not.or`) ·
 * `?order=col.desc,…` · `?select=id,title`.
 */

import { validationFailure } from "../../validation/standard-schema.ts";
import type { SqlPageOptions } from "./sql-session.ts";
import { resolveColumns, resolveTableName, type ResolvedColumn } from "./table.ts";

/** Whitelist for one list concern (`search` / `filter` / `order` / `select`). */
export type ColumnScope = "all" | readonly unknown[] | "none";

/** Pagination mode for a resource list. */
export type ListPageMode = "cursor" | "offset";

/** Offset-mode `COUNT(*)` policy. */
export type ListCountMode = "exact" | "none";

/** Declarative list surface (pre-resolution). */
export interface ListOptions {
  /** Pagination; default `"cursor"` when `cursor` columns are set. */
  readonly mode?: ListPageMode;
  /** Keyset columns (cursor mode). */
  readonly cursor?: readonly unknown[];
  /** Default sort when no `?order=` (default `"desc"`). */
  readonly direction?: "asc" | "desc";
  /** Default page size (default 20). */
  readonly limit?: number;
  /** Hard cap on `?limit=` (default 100). */
  readonly maxLimit?: number;
  /** Offset-only `COUNT(*)` (default `"exact"`). */
  readonly count?: ListCountMode;
  /** Substring search columns (`?search=` / `?q=`). Default `"none"`. */
  readonly search?: ColumnScope;
  /** Filter grammar columns (`?col=op.value`). Default `"none"`. */
  readonly filter?: ColumnScope;
  /** `?order=` columns. Default: cursor columns, else `"all"`. */
  readonly order?: ColumnScope;
  /** `?select=` projection columns (runtime only). Default `"all"`. */
  readonly select?: ColumnScope;
}

/** List config after defaults are applied. */
export interface ResolvedListConfig {
  readonly mode: ListPageMode;
  readonly cursor: readonly ResolvedColumn[];
  readonly direction: "asc" | "desc";
  readonly limit: number;
  readonly maxLimit: number;
  readonly count: ListCountMode;
  readonly search: readonly ResolvedColumn[];
  readonly filter: readonly ResolvedColumn[] | "none";
  readonly order: readonly ResolvedColumn[] | "none";
  readonly select: readonly ResolvedColumn[] | "all";
}

/** Fully-resolved parse-time scope for one list surface. */
export interface ListQueryScope {
  readonly mode: ListPageMode;
  readonly direction: "asc" | "desc";
  readonly limit: number;
  readonly maxLimit: number;
  readonly columns: readonly ResolvedColumn[];
  readonly tableColumns: Readonly<Record<string, unknown>>;
  readonly searchColumns: readonly ResolvedColumn[];
  /** `"none"` rejects the filter grammar entirely (unknown params fail). */
  readonly filterColumns: readonly ResolvedColumn[] | "none";
  readonly orderColumns: readonly ResolvedColumn[] | "none";
  readonly selectColumns: readonly ResolvedColumn[] | "all";
  readonly cursorColumns: readonly ResolvedColumn[];
}

/** Result of {@link resolveListScope} — everything a list surface needs. */
export interface ResolvedListScope {
  readonly mode: ListPageMode;
  readonly direction: "asc" | "desc";
  readonly limit: number;
  readonly maxLimit: number;
  readonly count: ListCountMode;
  /** Keyset columns (cursor mode), resolved against the table. */
  readonly cursorColumns: readonly ResolvedColumn[];
  /** Public introspection shape (defaults applied). */
  readonly listConfig: ResolvedListConfig;
  /** Parse-time scope for {@link parseListQuery}. */
  readonly query: ListQueryScope;
}

/* ———————————————————————————— drizzle-op builders (no drizzle import) ——— */

/** Build a Drizzle-shaped `SQL` leaf/group without importing `drizzle-orm`. */
export interface SqlOp {
  readonly queryChunks: readonly unknown[];
}
function strChunk(text: string): unknown {
  return { constructor: { name: "StringChunk" }, value: [text] };
}
function paramChunk(value: unknown): unknown {
  return { value };
}
export function leafOp(column: unknown, op: string, value: unknown): SqlOp {
  if (op === "is null" || op === "is not null") {
    return { queryChunks: [column, strChunk(` ${op}`)] };
  }
  if (op === "in") {
    const values = (value as readonly unknown[]).map(paramChunk);
    return { queryChunks: [column, strChunk(" in "), values] };
  }
  return { queryChunks: [column, strChunk(` ${op} `), paramChunk(value)] };
}
function groupOp(joiner: "and" | "or", parts: readonly SqlOp[]): SqlOp {
  const chunks: unknown[] = [];
  parts.forEach((part, i) => {
    if (i > 0) chunks.push(strChunk(` ${joiner} `));
    chunks.push(part);
  });
  return { queryChunks: chunks };
}
function ascOp(column: unknown): SqlOp {
  return { queryChunks: [column, strChunk(" asc")] };
}
function descOp(column: unknown): SqlOp {
  return { queryChunks: [column, strChunk(" desc")] };
}

/** Recursive keyset predicate for "rows strictly after the cursor point". */
function keysetAfter(
  columns: readonly unknown[],
  values: readonly unknown[],
  descending: boolean,
): SqlOp | undefined {
  const cmp = descending ? "<" : ">";
  const build = (i: number): SqlOp | undefined => {
    if (i >= columns.length) return undefined;
    const col = columns[i]!;
    const rest = build(i + 1);
    const tail =
      rest === undefined ? undefined : groupOp("and", [leafOp(col, "=", values[i]), rest]);
    return tail === undefined
      ? leafOp(col, cmp, values[i])
      : groupOp("or", [leafOp(col, cmp, values[i]), tail]);
  };
  return build(0);
}

/* —————————————————————————————— cursor codec —————————————————————————— */

/** Keyset token direction — `?cursor=` carries either side. */
export type CursorDir = "after" | "before";

export function encodeOffsetCursor(offset: number): string {
  return btoa(JSON.stringify({ k: "off", o: offset }));
}

function decodeOffsetCursor(raw: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (
      value !== null &&
      typeof value === "object" &&
      "k" in value &&
      value.k === "off" &&
      "o" in value &&
      typeof value.o === "number" &&
      Number.isInteger(value.o) &&
      value.o >= 0
    ) {
      return value.o;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeCursor(values: readonly unknown[], dir: CursorDir): string {
  return btoa(JSON.stringify({ v: values, d: dir }));
}
function decodeCursor(
  raw: string,
  arity: number,
): { readonly values: readonly unknown[]; readonly dir: CursorDir } | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (Array.isArray(value) && value.length === arity) {
      return { values: value, dir: "after" };
    }
    if (
      value !== null &&
      typeof value === "object" &&
      "v" in value &&
      "d" in value &&
      Array.isArray(value.v) &&
      value.v.length === arity &&
      (value.d === "after" || value.d === "before")
    ) {
      return { values: value.v as unknown[], dir: value.d };
    }
    return null;
  } catch {
    return null;
  }
}

function flipOrder(op: SqlOp): SqlOp {
  return {
    queryChunks: op.queryChunks.map((chunk) => {
      if (
        chunk !== null &&
        typeof chunk === "object" &&
        "value" in chunk &&
        Array.isArray((chunk as { value: unknown }).value)
      ) {
        const text = (chunk as { value: string[] }).value[0];
        if (text === " asc") return strChunk(" desc");
        if (text === " desc") return strChunk(" asc");
      }
      return chunk;
    }),
  };
}

/* —————————————————————————————— URL parsing ——————————————————————————— */

const RESERVED_PARAMS = new Set([
  "cursor",
  "limit",
  "offset",
  "search",
  "q",
  "order",
  "select",
  "or",
  "and",
]);

const FILTER_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);

function badInput(message: string, path: string) {
  return validationFailure([{ message, path: [path] }]);
}

function parseGroupLead(
  t: string,
): { readonly negated: boolean; readonly joiner: "and" | "or"; readonly body: string } | undefined {
  if (t.startsWith("not.and(")) return { negated: true, joiner: "and", body: t.slice(7) };
  if (t.startsWith("not.or(")) return { negated: true, joiner: "or", body: t.slice(6) };
  if (t.startsWith("and(")) return { negated: false, joiner: "and", body: t.slice(3) };
  if (t.startsWith("or(")) return { negated: false, joiner: "or", body: t.slice(2) };
  return undefined;
}

function negateTermString(term: string): string {
  const t = term.trim();
  if (t.startsWith("not.and(")) return `and${t.slice(7)}`;
  if (t.startsWith("not.or(")) return `or${t.slice(6)}`;
  if (t.startsWith("and(")) return `not.and${t.slice(3)}`;
  if (t.startsWith("or(")) return `not.or${t.slice(2)}`;
  const dot = t.indexOf(".");
  if (dot <= 0) return t;
  return `${t.slice(0, dot)}.${invertOpString(t.slice(dot + 1))}`;
}

/** Invert a PostgREST op string (`not.eq.x` → `neq.x`) so SQL stays a leaf. */
function invertOpString(raw: string): string {
  let rest = raw.trim();
  if (rest.startsWith("not.")) return rest.slice(4);
  const dot = rest.indexOf(".");
  if (dot <= 0) return raw;
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  if (op === "eq") return `neq.${value}`;
  if (op === "neq") return `eq.${value}`;
  if (op === "gt") return `lte.${value}`;
  if (op === "gte") return `lt.${value}`;
  if (op === "lt") return `gte.${value}`;
  if (op === "lte") return `gt.${value}`;
  if (op === "is" && (value === "null" || value === "unknown")) return "is.not_null";
  if (op === "is" && value === "not_null") return "is.null";
  if (op === "is" && value === "true") return "is.false";
  if (op === "is" && value === "false") return "is.true";
  return raw;
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let quote = false;
  for (const ch of inner) {
    if (quote) {
      if (ch === '"') quote = false;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      quote = true;
      buf += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) parts.push(buf.trim());
  return parts;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

/** Parse `eq.x` / `not.eq.x` / `in.(a,"b,c")` / `is.null` into a drizzle op. */
function filterOp(
  column: unknown,
  key: string,
  raw: string,
): SqlOp | { failure: ReturnType<typeof badInput> } {
  let rest = raw.trim();
  if (rest.startsWith("not.")) rest = invertOpString(rest);
  const dot = rest.indexOf(".");
  if (dot <= 0) return { failure: badInput(`expected "op.value" (e.g. ${key}=eq.x)`, key) };
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  if (!FILTER_OPS.has(op)) {
    return { failure: badInput(`unsupported filter op "${op}"`, key) };
  }
  let leaf: SqlOp | { failure: ReturnType<typeof badInput> };
  switch (op) {
    case "eq":
      leaf = leafOp(column, "=", unquote(value));
      break;
    case "neq":
      leaf = leafOp(column, "!=", unquote(value));
      break;
    case "gt":
      leaf = leafOp(column, ">", unquote(value));
      break;
    case "gte":
      leaf = leafOp(column, ">=", unquote(value));
      break;
    case "lt":
      leaf = leafOp(column, "<", unquote(value));
      break;
    case "lte":
      leaf = leafOp(column, "<=", unquote(value));
      break;
    case "like":
      leaf = leafOp(column, "like", unquote(value).replaceAll("*", "%"));
      break;
    case "ilike":
      leaf = leafOp(column, "ilike", unquote(value).replaceAll("*", "%"));
      break;
    case "is": {
      if (value === "null" || value === "unknown") leaf = leafOp(column, "is null", undefined);
      else if (value === "not_null") leaf = leafOp(column, "is not null", undefined);
      else if (value === "true") leaf = leafOp(column, "=", true);
      else if (value === "false") leaf = leafOp(column, "=", false);
      else leaf = { failure: badInput(`is expects null|not_null|true|false|unknown`, key) };
      break;
    }
    case "in": {
      const match = /^\((.*)\)$/.exec(value);
      if (!match) {
        leaf = { failure: badInput(`in expects (a,b,c)`, key) };
        break;
      }
      const inner = match[1]!.trim();
      const values = inner.length === 0 ? [] : splitTopLevel(inner).map(unquote);
      if (values.length === 0) {
        leaf = { failure: badInput(`in expects at least one value`, key) };
        break;
      }
      leaf = leafOp(column, "in", values);
      break;
    }
    default:
      leaf = { failure: badInput(`unsupported filter op "${op}"`, key) };
  }
  return leaf;
}

/** Split `or=(a.ilike.*x*,b.eq.1)` inner list on commas (nested-safe). */
function groupInner(raw: string): readonly string[] | null {
  const match = /^\((.*)\)$/.exec(raw.trim());
  if (!match) return null;
  const inner = match[1]!.trim();
  return inner.length === 0 ? [] : splitTopLevel(inner);
}

/** One `col.op.value` or nested `not.and(…)` term inside `or=` / `and=`. */
function groupedFilterTerm(
  tableColumns: Readonly<Record<string, unknown>>,
  term: string,
  joiner: "or" | "and",
): SqlOp | { failure: ReturnType<typeof badInput> } {
  const t = term.trim();
  const group = parseGroupLead(t);
  if (group) {
    const inner = groupInner(group.body);
    if (inner === null || inner.length === 0) {
      return { failure: badInput(`${group.joiner} expects (col.op.value,…)`, joiner) };
    }
    const innerJoiner = group.negated ? (group.joiner === "and" ? "or" : "and") : group.joiner;
    const parts: SqlOp[] = [];
    for (const piece of inner) {
      const next = group.negated ? negateTermString(piece) : piece;
      const op = groupedFilterTerm(tableColumns, next, innerJoiner);
      if ("failure" in op) return op;
      parts.push(op);
    }
    return parts.length === 1 ? parts[0]! : groupOp(innerJoiner, parts);
  }
  const dot = t.indexOf(".");
  if (dot <= 0) {
    return { failure: badInput(`expected "col.op.value" inside ${joiner}=(…)`, joiner) };
  }
  const col = tableColumns[t.slice(0, dot)];
  if (col === undefined) {
    return { failure: badInput(`unknown column "${t.slice(0, dot)}"`, joiner) };
  }
  return filterOp(col, joiner, t.slice(dot + 1));
}

/* ————————————————————————————— scope resolution ——————————————————————————— */

function scopeColumns(
  scope: ColumnScope,
  columns: readonly ResolvedColumn[],
  tableColumns: Readonly<Record<string, unknown>>,
): readonly ResolvedColumn[] | "none" | "all" {
  if (scope === "none") return "none";
  if (scope === "all") return columns;
  const allowed = new Set(
    scope
      .map((c) =>
        columns.find(
          (col) => tableColumns[col.key] === c || col.sqlName === (c as { name?: string }).name,
        ),
      )
      .filter((c): c is ResolvedColumn => c !== undefined),
  );
  return columns.filter((c) => allowed.has(c));
}

/**
 * Resolve a declarative list surface against a table: defaults applied,
 * column scopes narrowed, cursor columns bound. Pure — no driver, no IO.
 *
 * @param table - Drizzle / schema table
 * @param list - Declarative list options
 */
export function resolveListScope(table: unknown, list?: ListOptions): ResolvedListScope {
  const tableName = resolveTableName(table);
  void tableName;
  const columns = resolveColumns(table);
  const tableColumns = table as Readonly<Record<string, unknown>>;

  const opts = list ?? {};
  const cursorCols = opts.cursor ?? [];
  const resolvedCursor = cursorCols
    .map((c) =>
      columns.find(
        (col) => tableColumns[col.key] === c || col.sqlName === (c as { name?: string }).name,
      ),
    )
    .filter((c): c is ResolvedColumn => c !== undefined);
  const mode: ListPageMode = opts.mode ?? (resolvedCursor.length > 0 ? "cursor" : "offset");
  const direction = opts.direction ?? "desc";
  const limit = opts.limit ?? 20;
  const maxLimit = opts.maxLimit ?? 100;
  const countMode = opts.count ?? "exact";

  const searchCols = scopeColumns(opts.search ?? "none", columns, tableColumns);
  const filterCols = scopeColumns(opts.filter ?? "none", columns, tableColumns);
  const orderScope =
    opts.order ?? (resolvedCursor.length > 0 ? (cursorCols as readonly unknown[]) : "all");
  const orderCols = scopeColumns(orderScope, columns, tableColumns);
  const selectScope = opts.select ?? "all";

  const listConfig: ResolvedListConfig = {
    mode,
    cursor: resolvedCursor,
    direction,
    limit,
    maxLimit,
    count: countMode,
    search: searchCols === "none" || searchCols === "all" ? [] : searchCols,
    filter: filterCols === "none" ? "none" : filterCols === "all" ? columns : filterCols,
    order: orderCols === "none" ? "none" : orderCols === "all" ? columns : orderCols,
    select:
      selectScope === "all"
        ? "all"
        : (scopeColumns(selectScope, columns, tableColumns) as readonly ResolvedColumn[]),
  };

  const query: ListQueryScope = {
    mode,
    direction,
    limit,
    maxLimit,
    columns,
    tableColumns,
    searchColumns: listConfig.search,
    filterColumns: listConfig.filter,
    orderColumns: listConfig.order,
    selectColumns: listConfig.select,
    cursorColumns: resolvedCursor,
  };

  return {
    mode,
    direction,
    limit,
    maxLimit,
    count: countMode,
    cursorColumns: resolvedCursor,
    listConfig,
    query,
  };
}

/* ————————————————————————————— the parser ——————————————————————————— */

/** Parsed list input — page options plus shaping metadata. */
export type ListQueryResult =
  | {
      ok: true;
      page: SqlPageOptions;
      meta: Record<string, unknown>;
      select?: readonly ResolvedColumn[];
      cursorDir?: CursorDir;
    }
  | { ok: false; failure: unknown };

/**
 * Parse validated list input (the PostgREST grammar) into page options —
 * or a validation failure. Table-agnostic: the same function serves
 * `store.resource` lists, live query windows, and hand-written flows.
 *
 * @param input - Query record (already flattened URL params)
 * @param scope - Resolved surface from {@link resolveListScope}
 */
export function parseListQuery(input: unknown, scope: ListQueryScope): ListQueryResult {
  const {
    direction,
    limit,
    maxLimit,
    columns,
    tableColumns,
    searchColumns: searchList,
    filterColumns,
    orderColumns,
    selectColumns,
    cursorColumns: resolvedCursor,
    mode,
  } = scope;
  const filterAllowed = new Set(
    filterColumns === "none" ? [] : (filterColumns as readonly ResolvedColumn[]).map((c) => c.key),
  );
  const orderAllowed = new Set(
    orderColumns === "none" ? [] : (orderColumns as readonly ResolvedColumn[]).map((c) => c.key),
  );

  const query = (input ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined => {
    const v = query[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return undefined;
  };

  // limit
  let pageLimit = limit;
  const rawLimit = str("limit");
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, failure: badInput("limit must be a positive integer", "limit") };
    }
    pageLimit = Math.min(n, maxLimit);
  }

  const wheres: unknown[] = [];
  let meta: Record<string, unknown> = {};

  // search
  const search = str("search");
  const q = str("q");
  if (search !== undefined && q !== undefined) {
    return { ok: false, failure: badInput("use either search or q, not both", "search") };
  }
  const searchTerm = search ?? q;
  if (searchTerm !== undefined) {
    if (searchList.length === 0) {
      return {
        ok: false,
        failure: badInput("search is not enabled for this resource", "search"),
      };
    }
    const pattern = `%${searchTerm}%`;
    const parts = searchList
      .map((c) => tableColumns[c.key])
      .filter((c): c is unknown => c !== undefined)
      .map((c) => leafOp(c, "like", pattern) as SqlOp);
    wheres.push(parts.length === 1 ? parts[0] : groupOp("or", parts));
    meta.search = searchTerm;
  }

  // column filters
  if (filterColumns === "none") {
    for (const key of Object.keys(query)) {
      if (!RESERVED_PARAMS.has(key) && key !== "headers" && key !== "cookie") {
        return { ok: false, failure: badInput(`unknown list param "${key}"`, key) };
      }
    }
  } else {
    for (const [key, value] of Object.entries(query)) {
      if (RESERVED_PARAMS.has(key) || key === "headers" || key === "cookie") continue;
      if (typeof value !== "string") continue;
      const col = tableColumns[key];
      const resolved = columns.find((c) => c.key === key);
      if (col === undefined || resolved === undefined || !filterAllowed.has(key)) {
        return { ok: false, failure: badInput(`unknown or unfilterable column "${key}"`, key) };
      }
      const op = filterOp(col, key, value);
      if ("failure" in op) return { ok: false, failure: op.failure };
      wheres.push(op);
    }
    // or= / and= groups (one level)
    for (const joiner of ["or", "and"] as const) {
      const rawGroup = str(joiner);
      if (rawGroup === undefined) continue;
      const inner = groupInner(rawGroup);
      if (inner === null || inner.length === 0) {
        return { ok: false, failure: badInput(`${joiner} expects (col.op.value,…)`, joiner) };
      }
      const parts: SqlOp[] = [];
      for (const term of inner) {
        const op = groupedFilterTerm(tableColumns, term, joiner);
        if ("failure" in op) return { ok: false, failure: op.failure };
        parts.push(op);
      }
      wheres.push(parts.length === 1 ? parts[0] : groupOp(joiner, parts));
    }
  }

  // order
  let orders: SqlOp[] | undefined;
  const rawOrder = str("order");
  if (rawOrder !== undefined) {
    if (orderColumns === "none") {
      return { ok: false, failure: badInput("order is not enabled for this resource", "order") };
    }
    orders = [];
    for (const term of rawOrder.split(",")) {
      const [key, dir] = term.split(".");
      if (!key || (dir !== undefined && dir !== "asc" && dir !== "desc")) {
        return { ok: false, failure: badInput(`bad order term "${term}"`, "order") };
      }
      const col = tableColumns[key];
      const resolved = columns.find((c) => c.key === key);
      if (col === undefined || resolved === undefined || !orderAllowed.has(key)) {
        return {
          ok: false,
          failure: badInput(`unknown or unorderable column "${key}"`, "order"),
        };
      }
      orders.push(dir === "asc" ? ascOp(col) : descOp(col));
    }
    meta.order = rawOrder;
  } else if (resolvedCursor.length > 0) {
    orders = resolvedCursor.map((c) => {
      const col = tableColumns[c.key];
      return direction === "asc" ? ascOp(col) : descOp(col);
    });
  }

  // select projection
  let select: ResolvedColumn[] | undefined;
  const rawSelect = str("select");
  if (rawSelect !== undefined) {
    if (selectColumns !== "all") {
      return {
        ok: false,
        failure: badInput("select is not enabled for this resource", "select"),
      };
    }
    select = [];
    for (const key of rawSelect.split(",")) {
      const resolved = columns.find((c) => c.key === key);
      if (resolved === undefined) {
        return { ok: false, failure: badInput(`unknown column "${key}"`, "select") };
      }
      select.push(resolved);
    }
  }

  // pagination
  let offset: number | undefined;
  let after: unknown;
  let before: unknown;
  let cursorDir: CursorDir | undefined;
  let orderBy = orders;
  if (mode === "offset") {
    const rawCursor = str("cursor");
    const rawOffset = str("offset");
    if (rawCursor !== undefined) {
      const fromCursor = decodeOffsetCursor(rawCursor);
      if (fromCursor === null) {
        return { ok: false, failure: badInput("invalid cursor", "cursor") };
      }
      offset = fromCursor;
    } else if (rawOffset !== undefined) {
      const n = Number(rawOffset);
      if (!Number.isInteger(n) || n < 0) {
        return {
          ok: false,
          failure: badInput("offset must be a non-negative integer", "offset"),
        };
      }
      offset = n;
    }
  } else {
    const rawCursor = str("cursor");
    if (rawCursor !== undefined) {
      if (resolvedCursor.length === 0) {
        return { ok: false, failure: badInput("cursor pagination is not configured", "cursor") };
      }
      const decoded = decodeCursor(rawCursor, resolvedCursor.length);
      if (decoded === null) {
        return { ok: false, failure: badInput("invalid cursor", "cursor") };
      }
      cursorDir = decoded.dir;
      const cols = resolvedCursor.map((c) => tableColumns[c.key]);
      if (decoded.dir === "before") {
        before = keysetAfter(cols, decoded.values, direction !== "desc");
        orderBy = (orders ?? []).map(flipOrder);
      } else {
        after = keysetAfter(cols, decoded.values, direction === "desc");
      }
      meta.cursor = rawCursor;
    }
  }

  const where =
    wheres.length === 0
      ? undefined
      : wheres.length === 1
        ? wheres[0]
        : groupOp("and", wheres as SqlOp[]);
  return {
    ok: true,
    page: {
      where,
      orderBy,
      limit: pageLimit + (mode === "cursor" ? 1 : 0),
      offset,
      after,
      before,
    },
    meta: { mode, limit: pageLimit, ...meta },
    ...(select !== undefined ? { select } : {}),
    ...(cursorDir !== undefined ? { cursorDir } : {}),
  };
}
