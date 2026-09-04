/**
 * `oke db search-backfill` — explicit, resumable corpus + embedding backfill.
 * Never runs as a side effect of `oke db push`.
 */

import type { SqlConnection } from "../../drivers/types.ts";
import type { DeclaredColumn, Manifest } from "../../manifest/types.ts";
import { SEARCH_LOW_CORPUS_WARN_N } from "./search-errors.ts";
import {
  ensureHyperplaneInserts,
  OKE_SEARCH_DF,
  OKE_SEARCH_STATS,
  OKE_TSV_COL,
  searchDdlForTable,
} from "./search-ddl.ts";
import { tokenize } from "./search-bm25.ts";
import { embColumn, lshColumn, OKE_SEARCH_PLANES } from "./search-ddl.ts";
import { deserializePlanes, lshBucket } from "./search-lsh.ts";
import { LSH_DEFAULT_K, SearchConfigError } from "./search-errors.ts";

export interface SearchBackfillOptions {
  readonly table: string;
  readonly batchSize?: number;
  /** Sleep between embed batches (ms) — rate-limit pacing. */
  readonly embedPauseMs?: number;
  readonly embed?: (model: string, text: string) => Promise<readonly number[]>;
}

export interface SearchBackfillResult {
  readonly table: string;
  readonly rows: number;
  readonly embedded: number;
  readonly warnedLowCorpus: boolean;
}

/**
 * Apply search DDL + rebuild stats/DF + optional embeddings for one table.
 * Cursor-paginated; caller may wrap steps in Journal for resumability.
 *
 * @param conn - SQL connection
 * @param manifest - Project manifest
 * @param options - Table + batching
 */
export async function runSearchBackfill(
  conn: SqlConnection,
  manifest: Manifest,
  options: SearchBackfillOptions,
): Promise<SearchBackfillResult> {
  const tableMeta = findTable(manifest, options.table);
  if (!tableMeta) {
    throw new Error(`search-backfill: table "${options.table}" not found in Manifest`);
  }
  const { columns, pk } = tableMeta;
  const batchSize = options.batchSize ?? 32;
  const pauseMs = options.embedPauseMs ?? 100;

  for (const stmt of searchDdlForTable(options.table, columns)) {
    await conn.exec(stmt);
  }
  for (const ins of ensureHyperplaneInserts(options.table, columns)) {
    await conn.exec(ins.sql, ins.params);
  }

  // Rebuild DF + stats from full scan (pg_textsearch lesson: after data load).
  await conn.exec(`DELETE FROM ${OKE_SEARCH_DF} WHERE table_name = ?`, [options.table]);
  const df = new Map<string, number>();
  let n = 0;
  let totalLen = 0;
  let cursor: string | null = null;
  let embedded = 0;

  const embedCols = Object.entries(columns)
    .filter(([, c]) => c.embed)
    .map(([key, c]) => ({
      sqlName: c.sqlName ?? key,
      dims: c.embed!.dims,
      model: c.embed!.model ?? "default",
    }));

  for (;;) {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${options.table}`;
    if (cursor !== null) {
      sql += ` WHERE ${pk} > ?`;
      params.push(cursor);
    }
    sql += ` ORDER BY ${pk} ASC LIMIT ${batchSize}`;
    const rows = await conn.query(sql, params);
    if (rows.length === 0) break;

    for (const row of rows) {
      n += 1;
      const seenTerms = new Set<string>();
      let docLen = 0;
      for (const [key, col] of Object.entries(columns)) {
        if (!col.searchable) continue;
        const sqlName = col.sqlName ?? key;
        const tokens = tokenize(String(row[sqlName] ?? ""));
        docLen += tokens.length;
        for (const t of new Set(tokens)) {
          if (!seenTerms.has(t)) {
            seenTerms.add(t);
            df.set(t, (df.get(t) ?? 0) + 1);
          }
        }
      }
      totalLen += docLen;

      if (embedCols.length > 0 && options.embed) {
        const id = String(row[pk] ?? "");
        for (const col of embedCols) {
          const text = String(row[col.sqlName] ?? "");
          const vector = await options.embed(col.model, text);
          if (vector.length !== col.dims) {
            throw new SearchConfigError(
              options.table,
              col.sqlName,
              `embedding length ${vector.length} !== declared dims ${col.dims}`,
            );
          }
          const planesRows = await conn.query(
            `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
            [options.table, col.sqlName],
          );
          const prow = planesRows[0];
          if (!prow) {
            throw new SearchConfigError(options.table, col.sqlName, "missing hyperplanes");
          }
          const k = Number(prow["k"] ?? LSH_DEFAULT_K);
          const planes = deserializePlanes(Buffer.from(prow["planes"] as Buffer), k);
          const bucket = lshBucket(vector, planes);
          await conn.exec(
            `UPDATE ${options.table} SET ${embColumn(col.sqlName)} = ?, ${lshColumn(col.sqlName)} = ? WHERE ${pk} = ?`,
            [Array.from(vector), bucket.toString(), id],
          );
          embedded += 1;
        }
      }
      cursor = String(row[pk] ?? cursor);
    }

    if (embedCols.length > 0 && options.embed && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
    if (rows.length < batchSize) break;
  }

  const avgdl = n > 0 ? totalLen / n : 0;
  await conn.exec(
    `INSERT INTO ${OKE_SEARCH_STATS} (table_name, n, avgdl, updated_at)
     VALUES (?, ?, ?, now())
     ON CONFLICT (table_name) DO UPDATE SET n = EXCLUDED.n, avgdl = EXCLUDED.avgdl, updated_at = now()`,
    [options.table, n, avgdl],
  );
  for (const [term, count] of df) {
    await conn.exec(
      `INSERT INTO ${OKE_SEARCH_DF} (table_name, term, df) VALUES (?, ?, ?)
       ON CONFLICT (table_name, term) DO UPDATE SET df = EXCLUDED.df`,
      [options.table, term, count],
    );
  }

  const warnedLowCorpus = n < SEARCH_LOW_CORPUS_WARN_N;
  if (warnedLowCorpus) {
    console.warn(
      `[oke db search-backfill] warn: table "${options.table}" has only ${n} rows — IDF/BM25 corpus statistics are not meaningful yet (threshold ${SEARCH_LOW_CORPUS_WARN_N})`,
    );
  }

  // Touch generated tsv column by no-op update when needed — GENERATED ALWAYS is maintained by PG.
  void OKE_TSV_COL;

  return { table: options.table, rows: n, embedded, warnedLowCorpus };
}

function findTable(
  manifest: Manifest,
  tableName: string,
): { columns: Record<string, DeclaredColumn>; pk: string } | undefined {
  for (const store of Object.values(manifest.stores ?? {})) {
    if (store.facet !== "sql" || !store.tables?.[tableName]) continue;
    const table = store.tables[tableName]!;
    const columns: Record<string, DeclaredColumn> = {};
    let pk = "id";
    for (const [key, col] of Object.entries(table.columns ?? {})) {
      if (!col || typeof col !== "object") continue;
      const c = col as DeclaredColumn;
      columns[key] = c;
      if (c.primaryKey) pk = c.sqlName ?? key;
    }
    return { columns, pk };
  }
  return undefined;
}
