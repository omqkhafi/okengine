/**
 * `store.resource(db, table, opts)` — a CRUD + list resource factory.
 *
 * Declarative sugar, never new physics: every op is an ordinary `flow(name, {…})`
 * whose body composes `fx.store(db)` (select/insert/update/findById/delete +
 * `page`/`count`) through the existing Drizzle-condition compiler. Wire
 * binding stays in `on(http.resource(path, resource.all()))` — the factory
 * itself registers no triggers.
 *
 * List URL (PostgREST-shaped, UTF-8 values — English, Arabic, …):
 * `?cursor=` / `?offset=` / `?limit=` · `?search=` (`?q=` alias) ·
 * `?col=eq.x|neq|gt|gte|lt|lte|like.*p*|ilike.*p*|in.(a,b)|is.null|not_null|true|false` ·
 * `?col=not.eq.x` · `?or=(…)` / `?and=(…)` (nested `not.and` / `not.or`) ·
 * `?order=col.desc,…` · `?select=id,title`.
 * Every surface is whitelisted by a ColumnScope (`"all" | Column[] | "none"`).
 */

import { flow, type FlowDef, type FlowErrorMap } from "../../kernel/flow.ts";
import { fail } from "../../kernel/errors.ts";
import type { Fx } from "../../kernel/fx.ts";
import { validationFailure } from "../../validation/standard-schema.ts";
import { z } from "zod";
import type { SqlStoreDecl } from "./declare.ts";
import type { SqlRow } from "../../drivers/types.ts";
import { resolveColumns, resolveTableName, type ResolvedColumn } from "./table.ts";
import type { SqlPageOptions } from "./sql-session.ts";

/** Whitelist for one list concern (`search` / `filter` / `order` / `select`). */
export type ColumnScope = "all" | readonly unknown[] | "none";

/** Pagination mode for a resource list. */
export type ListPageMode = "cursor" | "offset";

/** Offset-mode `COUNT(*)` policy. */
export type ListCountMode = "exact" | "none";

/** Options for {@link resource}. */
export interface ResourceOptions {
  /** Create body schema (Standard Schema). */
  readonly in: unknown;
  /** Item schema (Standard Schema) — also the list item type. */
  readonly out: unknown;
  /** Update body schema; defaults to the partial of `in` when omitted. */
  readonly update?: unknown;
  /**
   * Update `:id` schema; defaults to `z.object({ id: z.string() })`. Only
   * used to extend `update` with the path id (wire sends `{ id, ...patch }`).
   */
  readonly idSchema?: unknown;
  /** Typed errors for get / update / remove (default `{ NotFound }`). */
  readonly errors?: FlowErrorMap;
  /** `:id` column; defaults to the table primary key. */
  readonly id?: unknown;
  /** List surface. */
  readonly list?: ResourceListOptions;
  /**
   * Acknowledge intentional Manifest contract breaks for the five flows
   * (`breaking: true` on each). Use when migrating a handwritten CRUD unit
   * onto `store.resource`.
   */
  readonly breaking?: boolean;
}

/** List options on {@link ResourceOptions}. */
export interface ResourceListOptions {
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

/** One CRUD op bundle returned by {@link resource}. */
export interface ResourceFlowDefs {
  readonly list: FlowDef<any, any, any>;
  readonly create: FlowDef<any, any, any>;
  readonly get: FlowDef<any, any, any>;
  readonly update: FlowDef<any, any, any>;
  readonly remove: FlowDef<any, any, any>;
}

/** Column lookup for {@link ResourceDef.page}. */
export interface ResourceColumns {
  /** Column property on the table by URL key (`createdAt` → drizzle col). */
  readonly columns: Readonly<Record<string, unknown>>;
  /** SQL name per URL key (for order compilation). */
  readonly sqlNameOf: (key: string) => string | undefined;
}

/** A resource factory result — FlowDefs plus introspection for `page`. */
export interface ResourceDef extends ResourceColumns {
  readonly list: FlowDef<any, any, any>;
  readonly create: FlowDef<any, any, any>;
  readonly get: FlowDef<any, any, any>;
  readonly update: FlowDef<any, any, any>;
  readonly remove: FlowDef<any, any, any>;
  /** Table name (SQL identifier). */
  readonly table: string;
  /** `:id` URL key. */
  readonly idKey: string;
  /** Default page size. */
  readonly limit: number;
  /** `?limit=` cap. */
  readonly maxLimit: number;
  /** Resolved list config (defaults applied). */
  readonly listConfig: ResolvedListConfig;
  /** All five ops for `http.resource(path, resource.all())`. */
  all(): ResourceFlowDefs;
  /** Input for {@link SqlStoreHandle.page} from validated list input. */
  page(input: unknown): SqlPageOptions & { readonly meta: Record<string, unknown> };
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

/* ———————————————————————————— drizzle-op builders (no drizzle import) ——— */

/** Build a Drizzle-shaped `SQL` leaf/group without importing `drizzle-orm`. */
interface SqlOp {
  readonly queryChunks: readonly unknown[];
}
function strChunk(text: string): unknown {
  return { constructor: { name: "StringChunk" }, value: [text] };
}
function paramChunk(value: unknown): unknown {
  return { value };
}
function leafOp(column: unknown, op: string, value: unknown): SqlOp {
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
type CursorDir = "after" | "before";

function encodeOffsetCursor(offset: number): string {
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

function encodeCursor(values: readonly unknown[], dir: CursorDir): string {
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

/* —————————————————————————————— the factory ——————————————————————————— */

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
 * Build a CRUD + list resource over a sql table. Returns FlowDefs plus
 * `.all()` for `on(http.resource(path, resource.all()))`.
 *
 * @param db - Sql store decl (`store.sql(...)`)
 * @param table - Drizzle / schema table
 * @param options - Contracts + list surface
 */
export function resource(db: SqlStoreDecl, table: unknown, options: ResourceOptions): ResourceDef {
  const tableName = resolveTableName(table);
  const columns = resolveColumns(table);
  const tableColumns = table as Readonly<Record<string, unknown>>;

  const pk = columns.find((c) => c.primary) ?? columns[0];
  const idColumn =
    options.id !== undefined
      ? columns.find(
          (c) =>
            tableColumns[c.key] === options.id ||
            c.sqlName === (options.id as { name?: string }).name,
        )
      : pk;
  const idKey = idColumn?.key ?? "id";
  const idDrizzleCol = idColumn !== undefined ? tableColumns[idColumn.key] : tableColumns.id;

  const list = options.list ?? {};
  const cursorCols = list.cursor ?? [];
  const resolvedCursor = cursorCols
    .map((c) =>
      columns.find(
        (col) => tableColumns[col.key] === c || col.sqlName === (c as { name?: string }).name,
      ),
    )
    .filter((c): c is ResolvedColumn => c !== undefined);
  const mode: ListPageMode = list.mode ?? (resolvedCursor.length > 0 ? "cursor" : "offset");
  const direction = list.direction ?? "desc";
  const limit = list.limit ?? 20;
  const maxLimit = list.maxLimit ?? 100;
  const countMode = list.count ?? "exact";

  const searchCols = scopeColumns(list.search ?? "none", columns, tableColumns);
  const filterCols = scopeColumns(list.filter ?? "none", columns, tableColumns);
  const orderScope =
    list.order ?? (resolvedCursor.length > 0 ? (cursorCols as readonly unknown[]) : "all");
  const orderCols = scopeColumns(orderScope, columns, tableColumns);
  const selectScope = list.select ?? "all";

  const filterAllowed = new Set(
    filterCols === "none" || filterCols === "all" ? [] : filterCols.map((c) => c.key),
  );
  const orderAllowed = new Set(
    orderCols === "none" || orderCols === "all" ? [] : orderCols.map((c) => c.key),
  );
  const searchList = searchCols === "none" || searchCols === "all" ? [] : searchCols;

  const config: ResolvedListConfig = {
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

  const errors = options.errors ?? ({ NotFound: {} as never } as FlowErrorMap);
  const breaking = options.breaking === true;

  /** Parse validated list input → page options or a validation failure. */
  function parseList(input: unknown):
    | {
        ok: true;
        page: SqlPageOptions;
        meta: Record<string, unknown>;
        select?: readonly ResolvedColumn[];
        cursorDir?: CursorDir;
      }
    | { ok: false; failure: unknown } {
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
    if (config.filter === "none") {
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
      if (config.order === "none") {
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
      if (config.select !== "all") {
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

  /** Run the list query and shape rows + meta. */
  async function runList(
    input: unknown,
    fx: Fx,
  ): Promise<{ data: SqlRow[]; meta: Record<string, unknown> } | { failure: unknown }> {
    const parsed = parseList(input);
    if (!parsed.ok) return { failure: parsed.failure };
    const store = fx.store(db) as {
      page(t: unknown, o: SqlPageOptions): Promise<SqlRow[]>;
      count(t: unknown, w?: unknown): Promise<number>;
      select(columns?: unknown): {
        from(t: unknown): {
          where(w: unknown): {
            orderBy(...o: unknown[]): { limit(n: number): Promise<SqlRow[]> };
          };
        };
      };
    };
    const rows = await store.page(table, parsed.page);
    const meta: Record<string, unknown> = { ...parsed.meta };

    let data: SqlRow[] = rows;
    if (mode === "cursor") {
      const pageSize = Number(parsed.meta.limit);
      const extra = rows.length > pageSize;
      const sliced = extra ? rows.slice(0, pageSize) : rows;
      const pageRows = parsed.cursorDir === "before" ? [...sliced].reverse() : sliced;
      const first = pageRows[0];
      const last = pageRows[pageRows.length - 1];
      const cursorValues = (row: SqlRow) => resolvedCursor.map((c) => row[c.key] ?? row[c.sqlName]);
      const hasNext = parsed.cursorDir === "before" ? pageRows.length > 0 : extra;
      const hasPrevious = parsed.cursorDir === "before" ? extra : parsed.cursorDir === "after";
      meta.next =
        hasNext && last !== undefined
          ? { cursor: encodeCursor(cursorValues(last), "after") }
          : null;
      meta.prev =
        hasPrevious && first !== undefined
          ? { cursor: encodeCursor(cursorValues(first), "before") }
          : null;
      data = pageRows;
    } else if (countMode === "exact") {
      meta.total = await store.count(table, parsed.page.where);
      meta.offset = parsed.page.offset ?? 0;
      const pageLimit = Number(parsed.meta.limit);
      const hasPrevious = Number(meta.offset) > 0;
      const hasNext = Number(meta.offset) + data.length < Number(meta.total);
      meta.next = hasNext ? { cursor: encodeOffsetCursor(Number(meta.offset) + pageLimit) } : null;
      meta.prev = hasPrevious
        ? { cursor: encodeOffsetCursor(Math.max(0, Number(meta.offset) - pageLimit)) }
        : null;
    } else {
      meta.offset = parsed.page.offset ?? 0;
      const pageLimit = Number(parsed.meta.limit);
      const hasPrevious = Number(meta.offset) > 0;
      const hasNext = data.length === pageLimit;
      meta.next = hasNext ? { cursor: encodeOffsetCursor(Number(meta.offset) + pageLimit) } : null;
      meta.prev = hasPrevious
        ? { cursor: encodeOffsetCursor(Math.max(0, Number(meta.offset) - pageLimit)) }
        : null;
    }

    if (parsed.select !== undefined) {
      const keep = new Set(parsed.select.map((c) => c.key));
      data = data.map((row) => {
        const out: SqlRow = {};
        for (const key of Object.keys(row)) if (keep.has(key)) out[key] = row[key];
        return out;
      });
    }
    return { data, meta };
  }

  const listFlow = flow("list", {
    ...(breaking ? { breaking: true as const } : {}),
    // Loose record so the HTTP AoT infers `query` and lets every list URL
    // key through; real validation happens in parseList (PostgREST grammar).
    in: z.record(z.string(), z.unknown()) as never,
    effects: { reads: [db.ref] },
    do: async (input, fx) => {
      const result = await runList(input, fx);
      if ("failure" in result) return result.failure;
      return fx.json.with(result);
    },
  });

  const createFlow = flow("create", {
    ...(breaking ? { breaking: true as const } : {}),
    in: options.in as never,
    effects: { writes: [db.ref] },
    do: async (input, fx) => {
      const store = fx.store(db) as {
        insert(t: unknown): { values(row: SqlRow): { returning(): Promise<SqlRow[]> } };
      };
      const [row] = await store
        .insert(table)
        .values(input as SqlRow)
        .returning();
      return fx.json.create(row);
    },
  });

  const getFlow = flow("get", {
    ...(breaking ? { breaking: true as const } : {}),
    errors,
    effects: { reads: [db.ref] },
    do: async (input, fx) => {
      const id = (input as Record<string, unknown>)[idKey];
      const store = fx.store(db) as {
        findById(t: unknown, id: string): Promise<SqlRow | null>;
      };
      const row = await store.findById(table, String(id));
      if (!row) return fail("NotFound", {});
      return row;
    },
  });

  // Wire update body is `{ id, ...patch }`. The patch schema (`update`,
  // default `in`) describes the mutable fields; the path id rides along and
  // must survive validation, so extend the ZodObject with the id key.
  const patchSchema: unknown = options.update ?? options.in;
  const updateIn =
    options.idSchema !== undefined
      ? options.idSchema
      : patchSchema instanceof z.ZodObject
        ? patchSchema.extend({ [idKey]: z.string() })
        : patchSchema;
  const updateFlow = flow("update", {
    ...(breaking ? { breaking: true as const } : {}),
    in: updateIn as never,
    errors,
    effects: { reads: [db.ref], writes: [db.ref] },
    do: async (input, fx) => {
      const { [idKey]: id, ...patch } = input as Record<string, unknown>;
      const store = fx.store(db) as {
        findById(t: unknown, id: string): Promise<SqlRow | null>;
        update(t: unknown): { set(row: SqlRow): { where(w: unknown): Promise<number> } };
      };
      const existing = await store.findById(table, String(id));
      if (!existing) return fail("NotFound", {});
      if (Object.keys(patch).length > 0) {
        await store
          .update(table)
          .set(patch as SqlRow)
          .where(leafOp(idDrizzleCol, "=", String(id)));
      }
      const row = await store.findById(table, String(id));
      if (!row) return fail("NotFound", {});
      return row;
    },
  });

  const removeFlow = flow("remove", {
    ...(breaking ? { breaking: true as const } : {}),
    errors,
    effects: { writes: [db.ref] },
    do: async (input, fx) => {
      const id = (input as Record<string, unknown>)[idKey];
      const store = fx.store(db) as {
        delete(t: unknown, id: string): Promise<boolean>;
      };
      const deleted = await store.delete(table, String(id));
      if (!deleted) return fail("NotFound", {});
      return fx.json.empty();
    },
  });

  const defs: ResourceFlowDefs = {
    list: listFlow as FlowDef<any, any, any>,
    create: createFlow as FlowDef<any, any, any>,
    get: getFlow as FlowDef<any, any, any>,
    update: updateFlow as FlowDef<any, any, any>,
    remove: removeFlow as FlowDef<any, any, any>,
  };

  return {
    ...defs,
    table: tableName,
    idKey,
    limit,
    maxLimit,
    listConfig: config,
    columns: tableColumns,
    sqlNameOf(key) {
      return columns.find((c) => c.key === key)?.sqlName;
    },
    all: () => defs,
    page(input) {
      const parsed = parseList(input);
      if (!parsed.ok) {
        throw new TypeError(
          `resource.page: invalid list input — ${JSON.stringify(parsed.failure)}`,
        );
      }
      return { ...parsed.page, meta: parsed.meta };
    },
  };
}
