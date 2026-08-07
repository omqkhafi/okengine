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
 * `?col=eq.x|neq|gt|gte|lt|lte|like.*p*|ilike.*p*|in.(a,b)|is.true|false|null` ·
 * `?or=(…)` / `?and=(…)` · `?order=col.desc,…` · `?select=id,title`.
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
  /** Flow unit scope (default: table name). Client namespace still comes from `adopt`. */
  readonly unit?: string;
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

function encodeCursor(values: readonly unknown[]): string {
  return btoa(JSON.stringify(values));
}
function decodeCursor(raw: string, arity: number): readonly unknown[] | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (!Array.isArray(value) || value.length !== arity) return null;
    return value as readonly unknown[];
  } catch {
    return null;
  }
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

/** Parse `eq.x` / `in.(a,b)` / `is.null` into a drizzle op over `column`. */
function filterOp(
  column: unknown,
  key: string,
  raw: string,
): SqlOp | { failure: ReturnType<typeof badInput> } {
  const dot = raw.indexOf(".");
  if (dot <= 0) return { failure: badInput(`expected "op.value" (e.g. ${key}=eq.x)`, key) };
  const op = raw.slice(0, dot);
  const value = raw.slice(dot + 1);
  if (!FILTER_OPS.has(op)) {
    return { failure: badInput(`unsupported filter op "${op}"`, key) };
  }
  switch (op) {
    case "eq":
      return leafOp(column, "=", value);
    case "neq":
      return leafOp(column, "!=", value);
    case "gt":
      return leafOp(column, ">", value);
    case "gte":
      return leafOp(column, ">=", value);
    case "lt":
      return leafOp(column, "<", value);
    case "lte":
      return leafOp(column, "<=", value);
    case "like":
      return leafOp(column, "like", value.replaceAll("*", "%"));
    case "ilike":
      return leafOp(column, "ilike", value.replaceAll("*", "%"));
    case "is": {
      if (value === "null") return leafOp(column, "is null", undefined);
      if (value === "true") return leafOp(column, "=", true);
      if (value === "false") return leafOp(column, "=", false);
      return { failure: badInput(`is expects null|true|false`, key) };
    }
    case "in": {
      const match = /^\((.*)\)$/.exec(value);
      if (!match) return { failure: badInput(`in expects (a,b,c)`, key) };
      const inner = match[1]!.trim();
      const values = inner.length === 0 ? [] : inner.split(",");
      if (values.length === 0) return { failure: badInput(`in expects at least one value`, key) };
      return leafOp(column, "in", values);
    }
  }
  return { failure: badInput(`unsupported filter op "${op}"`, key) };
}

/** Split `or=(a.ilike.*x*,b.eq.1)` inner list on commas. */
function groupInner(raw: string): readonly string[] | null {
  const match = /^\((.*)\)$/.exec(raw.trim());
  if (!match) return null;
  const inner = match[1]!.trim();
  return inner.length === 0 ? [] : inner.split(",");
}

/** One `col.op.value` term inside an `or=(…)` / `and=(…)` group. */
function groupedFilterTerm(
  tableColumns: Readonly<Record<string, unknown>>,
  term: string,
  joiner: "or" | "and",
): SqlOp | { failure: ReturnType<typeof badInput> } {
  const dot = term.indexOf(".");
  if (dot <= 0) {
    return { failure: badInput(`expected "col.op.value" inside ${joiner}=(…)`, joiner) };
  }
  const col = tableColumns[term.slice(0, dot)];
  if (col === undefined) {
    return { failure: badInput(`unknown column "${term.slice(0, dot)}"`, joiner) };
  }
  return filterOp(col, joiner, term.slice(dot + 1));
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
  const unit = options.unit ?? tableName;

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
    let orders: unknown[] | undefined;
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
    if (mode === "offset") {
      const rawOffset = str("offset");
      if (rawOffset !== undefined) {
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
        const values = decodeCursor(rawCursor, resolvedCursor.length);
        if (values === null) {
          return { ok: false, failure: badInput("invalid cursor", "cursor") };
        }
        after = keysetAfter(
          resolvedCursor.map((c) => tableColumns[c.key]),
          values,
          direction === "desc",
        );
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
        orderBy: orders,
        limit: pageLimit + (mode === "cursor" ? 1 : 0),
        offset,
        after,
      },
      meta: { mode, limit: pageLimit, ...meta },
      ...(select !== undefined ? { select } : {}),
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
      const hasNextPage = rows.length > pageSize;
      const pageRows = hasNextPage ? rows.slice(0, pageSize) : rows;
      const last = hasNextPage && pageRows.length > 0 ? pageRows[pageRows.length - 1] : undefined;
      meta.hasNextPage = hasNextPage;
      meta.nextCursor =
        last === undefined
          ? null
          : encodeCursor(resolvedCursor.map((c) => last[c.key] ?? last[c.sqlName]));
      data = pageRows;
    } else if (countMode === "exact") {
      meta.total = await store.count(table, parsed.page.where);
      meta.offset = parsed.page.offset ?? 0;
    } else {
      meta.offset = parsed.page.offset ?? 0;
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
    unit,
    ...(breaking ? { breaking: true as const } : {}),
    // Loose record so the HTTP AoT infers `query` and lets every list URL
    // key through; real validation happens in parseList (PostgREST grammar).
    in: z.record(z.string(), z.unknown()) as never,
    effects: { reads: [db.ref] },
    do: async (input, fx) => {
      const result = await runList(input, fx);
      if ("failure" in result) return result.failure;
      return fx.json.with(result.data, result.meta);
    },
  });

  const createFlow = flow("create", {
    unit,
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
    unit,
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
    unit,
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
    unit,
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
