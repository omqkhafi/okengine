/**
 * System-owned durable CDC flow that embeds `.embed()` columns asynchronously.
 * Writer flows never carry `effects.embeds` — only this flow does.
 */

import type { DeclaredColumn, Manifest } from "../../manifest/types.ts";
import type { Fx } from "../../kernel/fx.ts";
import { LSH_DEFAULT_K, SearchConfigError } from "./search-errors.ts";
import { embColumn, lshColumn, OKE_SEARCH_PLANES } from "./search-ddl.ts";
import { deserializePlanes, lshBucket } from "./search-lsh.ts";

/** CDC payload shape from bindRealtimeBridge / dispatchCdc. */
export interface SearchEmbedCdcPayload {
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/**
 * System flow name for a searchable-embed table.
 *
 * @param table - SQL table name
 */
export function searchEmbedFlowName(table: string): string {
  return `_oke_search_embed_${table}`;
}

/**
 * Collect tables that need the system embed CDC flow.
 *
 * @param manifest - Project manifest
 */
export function tablesNeedingSearchEmbed(manifest: Manifest): Array<{
  readonly table: string;
  readonly store: string;
  readonly columns: Array<{ sqlName: string; dims: number; model?: string }>;
  readonly pk: string;
}> {
  const out: Array<{
    readonly table: string;
    readonly store: string;
    readonly columns: Array<{ sqlName: string; dims: number; model?: string }>;
    readonly pk: string;
  }> = [];
  for (const [storeName, store] of Object.entries(manifest.stores ?? {})) {
    if (store.facet !== "sql" || !store.tables) continue;
    for (const [tableName, table] of Object.entries(store.tables)) {
      const embedCols: Array<{ sqlName: string; dims: number; model?: string }> = [];
      let pk = "id";
      for (const [key, col] of Object.entries(table.columns ?? {})) {
        if (!col || typeof col !== "object") continue;
        const c = col as DeclaredColumn;
        if (c.primaryKey) pk = c.sqlName ?? key;
        if (c.embed) {
          embedCols.push({
            sqlName: c.sqlName ?? key,
            dims: c.embed.dims,
            ...(c.embed.model ? { model: c.embed.model } : {}),
          });
        }
      }
      if (embedCols.length > 0) {
        out.push({ table: tableName, store: storeName, columns: embedCols, pk });
      }
    }
  }
  return out;
}

/**
 * Run one embed step for a CDC event (call inside `fx.step`).
 *
 * @param fx - Flow fx
 * @param table - Table name
 * @param pk - Primary key SQL name
 * @param columns - Embed columns
 * @param payload - CDC before/after
 * @param sqlRef - Resource ref for raw SQL (`sql:app`)
 */
export async function applySearchEmbedCdc(
  fx: Fx,
  table: string,
  pk: string,
  columns: Array<{ sqlName: string; dims: number; model?: string }>,
  payload: SearchEmbedCdcPayload,
  sqlRef: `sql:${string}`,
): Promise<void> {
  const store = fx.store({
    kind: "sql",
    name: sqlRef.slice(4),
    ref: sqlRef,
    facet: "sql",
  } as never);

  if (!payload.after) {
    // Delete — embeddings cleared with the row; nothing to do.
    return;
  }

  const id = String(payload.after[pk] ?? "");
  if (!id) return;

  for (const col of columns) {
    const text = String(payload.after[col.sqlName] ?? "");
    const beforeText =
      payload.before && typeof payload.before[col.sqlName] === "string"
        ? String(payload.before[col.sqlName])
        : undefined;
    if (beforeText !== undefined && beforeText === text) continue;

    const model = col.model ?? "default";
    const vector = await fx.embed(model, text);
    if (vector.length !== col.dims) {
      throw new SearchConfigError(
        table,
        col.sqlName,
        `embedding length ${vector.length} !== declared dims ${col.dims}`,
      );
    }

    const planesRows = await store.raw(
      `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
      [table, col.sqlName],
    );
    const prow = planesRows[0];
    if (!prow) {
      throw new SearchConfigError(
        table,
        col.sqlName,
        "missing hyperplanes — ensure search DDL / search-backfill ran",
      );
    }
    const k = Number(prow["k"] ?? LSH_DEFAULT_K);
    const planes = deserializePlanes(Buffer.from(prow["planes"] as Buffer), k);
    const bucket = lshBucket(vector, planes);

    await store.raw(
      `UPDATE ${table} SET ${embColumn(col.sqlName)} = ?, ${lshColumn(col.sqlName)} = ? WHERE ${pk} = ?`,
      [Array.from(vector), bucket.toString(), id],
    );
  }
}
