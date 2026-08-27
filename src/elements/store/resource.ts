/**
 * `store.resource(db, table, opts)` — a CRUD + list resource factory.
 *
 * Declarative sugar, never new physics: every op is an ordinary `flow(name, {…})`
 * whose body composes `fx.store(db)` (select/insert/update/findById/delete +
 * `page`/`count`) through the existing Drizzle-condition compiler. Wire
 * binding stays in `on(http.resource(path, resource.all()))` — the factory
 * itself registers no triggers.
 *
 * List URL grammar and parsing live in `list-query.ts` (shared with live
 * query windows and hand-written flows); this factory resolves its
 * declarative scopes and wires the parsed page into `fx.store(db)`.
 */

import { flow, type AnyFlowDef, type FlowDef, type FlowErrorMap } from "../../kernel/flow.ts";
import { fail } from "../../kernel/errors.ts";
import type { Fx } from "../../kernel/fx.ts";
import {
  openLiveStream,
  realtimeBridgeRuntime,
  type LiveColumnKind,
} from "../../kernel/realtime-bind.ts";
import { compileWhere } from "./sql-condition.ts";
import { z } from "zod";
import type { SqlStoreDecl } from "./declare.ts";
import type { SqlRow } from "../../drivers/types.ts";
import { resolveColumns, resolveTableName } from "./table.ts";
import type { SqlPageOptions } from "./sql-session.ts";
import {
  encodeCursor,
  encodeOffsetCursor,
  leafOp,
  parseListQuery,
  resolveListScope,
  type ResolvedListConfig,
} from "./list-query.ts";

export type { ColumnScope, ListCountMode, ListPageMode } from "./list-query.ts";
export type { ResolvedListConfig } from "./list-query.ts";

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
  /**
   * Enable the live query stack: compiler synthesizes an internal Signal
   * (`oke/live/sql:<table>`), wires CDC fan-out, and mounts
   * `GET <path>/live` when used with `http.resource`. Requires RLS-capable
   * SQL drivers (postgres / pglite).
   */
  readonly live?: boolean;
}

/** List options on {@link ResourceOptions}. */
export interface ResourceListOptions {
  /** Pagination; default `"cursor"` when `cursor` columns are set. */
  readonly mode?: import("./list-query.ts").ListPageMode;
  /** Keyset columns (cursor mode). */
  readonly cursor?: readonly unknown[];
  /** Default sort when no `?order=` (default `"desc"`). */
  readonly direction?: "asc" | "desc";
  /** Default page size (default 20). */
  readonly limit?: number;
  /** Hard cap on `?limit=` (default 100). */
  readonly maxLimit?: number;
  /** Offset-only `COUNT(*)` (default `"exact"`). */
  readonly count?: import("./list-query.ts").ListCountMode;
  /** Substring search columns (`?search=` / `?q=`). Default `"none"`. */
  readonly search?: import("./list-query.ts").ColumnScope;
  /** Filter grammar columns (`?col=op.value`). Default `"none"`. */
  readonly filter?: import("./list-query.ts").ColumnScope;
  /** `?order=` columns. Default: cursor columns, else `"all"`. */
  readonly order?: import("./list-query.ts").ColumnScope;
  /** `?select=` projection columns (runtime only). Default `"all"`. */
  readonly select?: import("./list-query.ts").ColumnScope;
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

/**
 * Live query surface synthesized for `store.resource(…, { live: true })`.
 *
 * The signal carries classified {@link LiveQueryEvent}-shaped payloads;
 * `flow` is a `delivery: "live"` SSE consumer (`fx.live` physics) that the
 * app mounts on `GET <resource>/live`. The realtime bridge publishes to the
 * same signal name, so transport, retention, and Last-Event-ID resume are
 * the already-proven Signal stack.
 */
export interface ResourceLiveSurface {
  /** Internal signal name — `oke/live/sql:<table>`. */
  readonly signal: string;
  /** Default subscribe path — `<mount path>/live` is derived at mount. */
  readonly flow: AnyFlowDef;
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
  /**
   * Live query surface when `live: true` — signal name + SSE Flow to mount.
   * Absent otherwise.
   */
  readonly live?: ResourceLiveSurface;
  /** All five ops for `http.resource(path, resource.all())`. */
  all(): ResourceFlowDefs;
  /** Input for {@link SqlStoreHandle.page} from validated list input. */
  page(input: unknown): SqlPageOptions & { readonly meta: Record<string, unknown> };
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

  const scope = resolveListScope(table, options.list);
  const config = scope.listConfig;
  const { mode, limit, maxLimit, cursorColumns: resolvedCursor } = scope;
  const countMode = scope.count;

  const errors = options.errors ?? ({ NotFound: {} as never } as FlowErrorMap);
  const breaking = options.breaking === true;

  /** Run the list query and shape rows + meta. */
  async function runList(
    input: unknown,
    fx: Fx,
  ): Promise<{ data: SqlRow[]; meta: Record<string, unknown> } | { failure: unknown }> {
    const parsed = parseListQuery(input, scope.query);
    if (!parsed.ok) return { failure: parsed.failure };
    const store = fx.store(db) as {
      page(t: unknown, o: SqlPageOptions): Promise<SqlRow[]>;
      count(t: unknown, w?: unknown): Promise<number>;
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
    // key through; real validation happens in parseListQuery (PostgREST
    // grammar).
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

  // Live query surface — internal signal name + SSE stream Flow. Developers
  // mount it via `http.resource` (or a manual `.live()` GET); the realtime
  // bridge classifies CDC events per subscriber and pushes through this
  // flow. Classified events are per-identity RLS verdicts, so delivery is
  // direct per-subscriber push — never a shared signal tape.
  const liveSurface: ResourceLiveSurface | undefined = options.live
    ? (() => {
        const signalName = `oke/live/sql:${tableName}`;
        const pkColumn = idColumn?.sqlName ?? idKey;
        const columnKinds: Record<string, LiveColumnKind> = {};
        for (const c of columns) {
          const kind: LiveColumnKind | undefined =
            c.sqlType === "BOOLEAN"
              ? "boolean"
              : c.sqlType === "INTEGER" || c.sqlType === "BIGINT" || c.sqlType === "REAL"
                ? "number"
                : c.sqlType === "JSONB"
                  ? undefined
                  : "string";
          if (kind !== undefined) columnKinds[c.key] = kind;
        }
        const liveFlow = flow(`_live_${tableName}`, {
          ...(options.out !== undefined ? { out: options.out } : {}),
          effects: { reads: [db.ref, `signal:${signalName}`] },
          do: async (input: unknown, fx: Fx) => {
            const bridge = realtimeBridgeRuntime();
            if (!bridge) {
              throw new Error(
                `live query for "${tableName}" requires an RLS-capable SQL driver (postgres / pglite)`,
              );
            }
            // Same PostgREST window as the list Flow — filters decide whether
            // a row belongs to this live query ("query exit"), RLS decides
            // visibility. Pagination cursors don't gate membership.
            const parsed = parseListQuery(input, scope.query);
            if (!parsed.ok) return parsed.failure;
            let whereSql: string | undefined;
            let whereParams: readonly unknown[] = [];
            const pageWhere = parsed.page.where;
            if (pageWhere !== undefined) {
              const compiled = compileWhere(pageWhere);
              if (compiled.clause !== "") {
                whereSql = compiled.clause;
                whereParams = compiled.params;
              }
            }
            const identity = fx.rlsIdentity;
            if (!identity) {
              throw new Error(`live query for "${tableName}" requires a gated identity`);
            }
            const stream = openLiveStream(fx.id(), {
              table: tableName,
              identity,
              pkColumn,
              ...(whereSql !== undefined ? { whereSql } : {}),
              ...(whereParams.length > 0 ? { whereParams } : {}),
              ...(Object.keys(columnKinds).length > 0 ? { tableColumns: columnKinds } : {}),
            });
            return fx.json.stream(stream.chunks);
          },
        }) as unknown as AnyFlowDef;
        return { signal: signalName, flow: liveFlow };
      })()
    : undefined;

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
      const parsed = parseListQuery(input, scope.query);
      if (!parsed.ok) {
        throw new TypeError(
          `resource.page: invalid list input — ${JSON.stringify(parsed.failure)}`,
        );
      }
      return { ...parsed.page, meta: parsed.meta };
    },
    ...(liveSurface ? { live: liveSurface } : {}),
  };
}
