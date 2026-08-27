/**
 * `liveQuery(fx, table, input, opts?)` — open a live query window for a
 * hand-written Flow, reusing 100% of the shipped realtime stack.
 *
 * The companion to the `.live(table)` trigger modifier: parse the same
 * PostgREST grammar as `store.resource` lists (`parseListQuery`), compile
 * the window to SQL, stamp the caller's RLS identity, and open a
 * classified CDC stream (`openLiveStream`) — returned as an SSE body via
 * `fx.json.stream`. No new transport, no new classification; just the
 * declaration surface the resource path previously owned.
 */

import type { Fx } from "../../kernel/fx.ts";
import type { JsonStreamResult } from "../../kernel/fx.ts";
import {
  openLiveStream,
  realtimeBridgeRuntime,
  type LiveColumnKind,
} from "../../kernel/realtime-bind.ts";
import { compileWhere } from "./sql-condition.ts";
import { parseListQuery, resolveListScope, type ListOptions } from "./list-query.ts";
import { resolveColumns, resolveTableName } from "./table.ts";

/**
 * Subscribe the current SSE response to classified live events for one
 * table — filtered by the same list grammar as `store.resource` lists and
 * classified per-subscriber (RLS + query window) by the realtime bridge.
 *
 * @param fx - Flow `fx` door (identity + json stream physics)
 * @param table - `store.schema.table` (or drizzle / table handle) binding
 * @param input - Query record (the GET request's parsed query params)
 * @param opts - Optional list surface (search/filter/order/select scopes)
 * @returns The SSE stream body to return from the Flow's `do`
 */
export function liveQuery(
  fx: Fx,
  table: unknown,
  input: unknown,
  opts?: ListOptions,
): JsonStreamResult {
  const tableName = resolveTableName(table);
  const columns = resolveColumns(table);
  const scope = resolveListScope(table, opts);

  const bridge = realtimeBridgeRuntime();
  if (!bridge) {
    throw new Error(
      `live query for "${tableName}" requires an RLS-capable SQL driver (postgres / pglite)`,
    );
  }

  // Same PostgREST window as the resource list Flow — filters decide
  // whether a row belongs to this live query ("query exit"), RLS decides
  // visibility. Pagination cursors don't gate membership.
  const parsed = parseListQuery(input, scope.query);
  if (!parsed.ok) return parsed.failure as unknown as JsonStreamResult;

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

  const pkColumn = columns.find((c) => c.primary)?.sqlName ?? columns[0]?.sqlName ?? "id";
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

  const stream = openLiveStream(fx.id(), {
    table: tableName,
    identity,
    pkColumn,
    ...(whereSql !== undefined ? { whereSql } : {}),
    ...(whereParams.length > 0 ? { whereParams } : {}),
    ...(Object.keys(columnKinds).length > 0 ? { tableColumns: columnKinds } : {}),
  });
  return fx.json.stream(stream.chunks);
}
