/**
 * Plain-SQL DDL for built-in hybrid search (PostgreSQL 15+, zero extensions).
 */

import type { DeclaredColumn } from "../../manifest/types.ts";
import { LSH_DEFAULT_K } from "./search-errors.ts";
import {
  generateHyperplanes,
  hyperplaneSeed,
  serializePlanes,
} from "./search-lsh.ts";

/** Shadow / system column and index names. */
export const OKE_TSV_COL = "__oke_tsv";
export const OKE_SEARCH_STATS = "oke_search_stats";
export const OKE_SEARCH_DF = "oke_search_df";
export const OKE_SEARCH_PLANES = "oke_search_planes";

/**
 * @param sqlName - Column SQL name
 */
export function embColumn(sqlName: string): string {
  return `__oke_emb_${sqlName}`;
}

/**
 * @param sqlName - Column SQL name
 */
export function lshColumn(sqlName: string): string {
  return `__oke_lsh_${sqlName}`;
}

/**
 * Emit CREATE TABLE / ALTER / INDEX statements for searchable columns.
 *
 * @param table - SQL table name
 * @param columns - Manifest columns map
 */
export function searchDdlForTable(
  table: string,
  columns: Record<string, DeclaredColumn>,
): string[] {
  const searchable: Array<{ key: string; sqlName: string; weight: number }> = [];
  const embedCols: Array<{ key: string; sqlName: string; dims: number; model?: string }> = [];
  for (const [key, col] of Object.entries(columns)) {
    if (!col.searchable) continue;
    const sqlName = col.sqlName ?? key;
    searchable.push({ key, sqlName, weight: col.searchable.weight });
    if (col.embed) {
      embedCols.push({
        key,
        sqlName,
        dims: col.embed.dims,
        ...(col.embed.model ? { model: col.embed.model } : {}),
      });
    }
  }
  if (searchable.length === 0) return [];

  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS ${OKE_SEARCH_STATS} (
      table_name text PRIMARY KEY,
      n bigint NOT NULL DEFAULT 0,
      avgdl double precision NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${OKE_SEARCH_DF} (
      table_name text NOT NULL,
      term text NOT NULL,
      df bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (table_name, term)
    )`,
    `CREATE TABLE IF NOT EXISTS ${OKE_SEARCH_PLANES} (
      table_name text NOT NULL,
      column_name text NOT NULL,
      dims integer NOT NULL,
      k integer NOT NULL,
      seed text NOT NULL,
      planes bytea NOT NULL,
      PRIMARY KEY (table_name, column_name)
    )`,
  ];

  // Weighted tsvector expression for GIN candidate retrieval.
  const tsvParts = searchable.map((c) => `coalesce(to_tsvector('english', ${quoteIdent(c.sqlName)}), '')`);
  const tsvExpr = tsvParts.join(" || ");
  stmts.push(
    `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${OKE_TSV_COL} tsvector GENERATED ALWAYS AS (${tsvExpr}) STORED`,
  );
  stmts.push(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_${OKE_TSV_COL}_gin`)} ON ${quoteIdent(table)} USING gin (${OKE_TSV_COL})`,
  );

  for (const c of embedCols) {
    stmts.push(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(embColumn(c.sqlName))} real[]`,
    );
    stmts.push(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(lshColumn(c.sqlName))} bigint`,
    );
    stmts.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_${lshColumn(c.sqlName)}_btree`)} ON ${quoteIdent(table)} (${quoteIdent(lshColumn(c.sqlName))})`,
    );
  }

  return stmts;
}

/**
 * Insert-once hyperplane rows for embed columns (never regenerate).
 *
 * @param table - SQL table
 * @param columns - Manifest columns
 */
export function ensureHyperplaneInserts(
  table: string,
  columns: Record<string, DeclaredColumn>,
): Array<{ sql: string; params: unknown[] }> {
  const out: Array<{ sql: string; params: unknown[] }> = [];
  for (const [key, col] of Object.entries(columns)) {
    if (!col.embed) continue;
    const sqlName = col.sqlName ?? key;
    const dims = col.embed.dims;
    const k = LSH_DEFAULT_K;
    const seed = hyperplaneSeed(table, sqlName, dims, k);
    const planes = generateHyperplanes(seed, dims, k);
    const blob = serializePlanes(planes);
    out.push({
      sql: `INSERT INTO ${OKE_SEARCH_PLANES} (table_name, column_name, dims, k, seed, planes)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (table_name, column_name) DO NOTHING`,
      params: [table, sqlName, dims, k, seed, blob],
    });
  }
  return out;
}

/**
 * Minimum PostgreSQL major version for hybrid search DDL.
 */
export const SEARCH_PG_MIN_MAJOR = 15;

/**
 * @param versionString - `SELECT version()` / `server_version` text
 */
export function parsePgMajor(versionString: string): number | undefined {
  const m = /(\d+)\.\d+/.exec(versionString);
  if (!m) return undefined;
  return Number(m[1]);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    return `"${name.replaceAll('"', '""')}"`;
  }
  return name;
}
