/**
 * Built-in hybrid search runtime — BM25F ± LSH ± RRF/weighted fusion,
 * composing {@link parseListQuery} for ordinary filters / pagination.
 */

import type { PromptRef } from "../../manifest/types.ts";
import type { SqlConnection, SqlRow } from "../../drivers/types.ts";
import {
  parseListQuery,
  resolveListScope,
  type ListOptions,
} from "./list-query.ts";
import { bm25fScore, termFrequencies, tokenize } from "./search-bm25.ts";
import { SearchConfigError, LSH_DEFAULT_K } from "./search-errors.ts";
import { fuseLists, type FuseOptions } from "./search-fusion.ts";
import {
  cosineSimilarity,
  deserializePlanes,
  lshBucket,
  neighborBuckets,
} from "./search-lsh.ts";
import {
  embColumn,
  lshColumn,
  OKE_SEARCH_DF,
  OKE_SEARCH_PLANES,
  OKE_SEARCH_STATS,
  OKE_TSV_COL,
} from "./search-ddl.ts";
import { compileWhere } from "./sql-condition.ts";
import { resolveTableName, type TableHandle } from "./table.ts";

/** Search options — `query` / `fuse` / `rerank` are search-specific; rest is list grammar. */
export interface SqlSearchOptions extends ListOptions {
  /** Hybrid relevance string (BM25 ± semantic). Not the same as list `?search=` LIKE. */
  readonly query: string;
  readonly fuse?: FuseOptions;
  /** Default `false` — never silently invokes fx.ask. */
  readonly rerank?: false | { readonly model: PromptRef };
  /** Extra PostgREST-shaped filter input (same as list / live). */
  readonly filterInput?: unknown;
}

export interface SqlSearchResult {
  readonly data: SqlRow[];
  readonly meta: {
    readonly engine: Array<"bm25" | "lsh">;
    readonly fusedBy?: "rrf" | "weighted";
    readonly rrfK?: number;
    readonly limit: number;
  };
}

export interface SearchColumnMeta {
  readonly key: string;
  readonly sqlName: string;
  readonly weight: number;
  readonly embed?: { readonly dims: number; readonly model?: string };
}

export interface RunSqlSearchDeps {
  readonly conn: SqlConnection;
  readonly table: TableHandle | unknown;
  readonly columns: readonly SearchColumnMeta[];
  readonly pkSqlName: string;
  readonly options: SqlSearchOptions;
  /** Optional embed for the query string when LSH fields exist. */
  readonly embedQuery?: (text: string, model?: string) => Promise<readonly number[]>;
  /** Optional rerank via fx.ask — only when options.rerank is set. */
  readonly askRerank?: (
    model: PromptRef,
    input: {
      query: string;
      docs: Array<{ id: string; text: string; score: number }>;
    },
  ) => Promise<{ rankedIds?: string[] }>;
}

/**
 * Execute hybrid search against PostgreSQL using GIN + LSH B-tree candidates,
 * then BM25F / cosine / fusion in-process (correct, testable math).
 *
 * @param deps - Connection, table meta, options
 */
export async function runSqlSearch(deps: RunSqlSearchDeps): Promise<SqlSearchResult> {
  const { conn, options, columns, pkSqlName } = deps;
  const tableName = resolveTableName(deps.table);
  if (!tableName) throw new Error("search(): table name could not be resolved");

  const searchable = columns.filter((c) => c.weight > 0);
  if (searchable.length === 0) {
    throw new SearchConfigError(tableName, "*", "no .searchable() columns on this table");
  }

  const { query, fuse, rerank, filterInput, ...listOpts } = options;
  const scope = resolveListScope(deps.table, listOpts);
  const parsed = parseListQuery(filterInput ?? {}, scope.query);
  if (!parsed.ok) {
    throw parsed.failure instanceof Error
      ? parsed.failure
      : new Error(`search(): invalid list filters (${String(parsed.failure)})`);
  }

  const limit = parsed.page.limit ?? scope.limit;
  const engines: Array<"bm25" | "lsh"> = ["bm25"];
  const embedFields = searchable.filter((c) => c.embed);
  if (embedFields.length > 0) engines.push("lsh");

  // Candidate retrieval: GIN tsvector match OR LSH buckets.
  const params: unknown[] = [query];
  let whereSql = `${OKE_TSV_COL} @@ plainto_tsquery('english', ?)`;
  let queryVec: readonly number[] | undefined;
  const bucketParams: bigint[] = [];

  if (embedFields.length > 0 && deps.embedQuery) {
    const model = embedFields[0]?.embed?.model;
    queryVec = await deps.embedQuery(query, model);
    for (const field of embedFields) {
      const dims = field.embed!.dims;
      if (queryVec.length !== dims) {
        throw new SearchConfigError(
          tableName,
          field.sqlName,
          `query embedding length ${queryVec.length} !== declared dims ${dims}`,
        );
      }
      const planesRow = await conn.query(
        `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
        [tableName, field.sqlName],
      );
      const row = planesRow[0];
      if (!row) {
        throw new SearchConfigError(
          tableName,
          field.sqlName,
          `missing hyperplanes — run oke db search-backfill or ensure push applied search DDL`,
        );
      }
      const k = Number(row["k"] ?? LSH_DEFAULT_K);
      const planesBuf = row["planes"] as Buffer;
      const planes = deserializePlanes(Buffer.from(planesBuf), k);
      const bucket = lshBucket(queryVec, planes);
      for (const b of neighborBuckets(bucket, k)) {
        bucketParams.push(b);
      }
      whereSql += ` OR ${lshColumn(field.sqlName)} = ANY(?)`;
      params.push(bucketParams.map((b) => b.toString()));
    }
  }

  // Compose list-grammar filters.
  if (parsed.page.where) {
    const compiled = compileWhere(parsed.page.where);
    if (compiled.clause) {
      whereSql = `(${whereSql}) AND (${compiled.clause})`;
      params.push(...compiled.params);
    }
  }

  const selectCols = [
    quoteIdent(pkSqlName),
    ...searchable.map((c) => quoteIdent(c.sqlName)),
    ...embedFields.map((c) => quoteIdent(embColumn(c.sqlName))),
  ].join(", ");

  // Oversample candidates for fusion then truncate.
  const fetchLimit = Math.min(Math.max(limit * 5, 50), 500);
  const candidateSql = `SELECT ${selectCols} FROM ${quoteIdent(tableName)} WHERE ${whereSql} LIMIT ${fetchLimit}`;
  const candidates = await conn.query(candidateSql, params);

  const statsRows = await conn.query(
    `SELECT n, avgdl FROM ${OKE_SEARCH_STATS} WHERE table_name = ?`,
    [tableName],
  );
  const N = Number(statsRows[0]?.["n"] ?? candidates.length) || candidates.length;
  const avgdl = Number(statsRows[0]?.["avgdl"] ?? 50) || 50;

  const dfRows = await conn.query(
    `SELECT term, df FROM ${OKE_SEARCH_DF} WHERE table_name = ?`,
    [tableName],
  );
  const df = new Map<string, number>();
  for (const r of dfRows) {
    df.set(String(r["term"]), Number(r["df"] ?? 0));
  }

  const qTerms = tokenize(query);
  const bm25Hits: Array<{ id: string; score: number; rank: number; row: SqlRow }> = [];
  const vecHits: Array<{ id: string; score: number; rank: number; row: SqlRow }> = [];

  for (const row of candidates) {
    const id = String(row[pkSqlName] ?? row["id"] ?? "");
    const fields = searchable.map((c) => {
      const text = String(row[c.sqlName] ?? "");
      return { weight: c.weight, tf: termFrequencies(tokenize(text)) };
    });
    let docLen = 0;
    for (const f of fields) {
      for (const n of f.tf.values()) docLen += n;
    }
    const score = bm25fScore(qTerms, fields, docLen, avgdl, N, df);
    bm25Hits.push({ id, score, rank: 0, row });
  }
  bm25Hits.sort((a, b) => b.score - a.score);
  bm25Hits.forEach((h, i) => {
    h.rank = i + 1;
  });

  if (queryVec && embedFields.length > 0) {
    for (const row of candidates) {
      const id = String(row[pkSqlName] ?? row["id"] ?? "");
      let best = -1;
      for (const field of embedFields) {
        const emb = row[embColumn(field.sqlName)];
        if (!Array.isArray(emb)) continue;
        if (emb.length !== field.embed!.dims) {
          throw new SearchConfigError(
            tableName,
            field.sqlName,
            `stored embedding length ${emb.length} !== declared dims ${field.embed!.dims}`,
          );
        }
        const sim = cosineSimilarity(queryVec, emb as number[]);
        if (sim > best) best = sim;
      }
      if (best >= 0) vecHits.push({ id, score: best, rank: 0, row });
    }
    vecHits.sort((a, b) => b.score - a.score);
    vecHits.forEach((h, i) => {
      h.rank = i + 1;
    });
  }

  const rowById = new Map<string, SqlRow>();
  for (const h of bm25Hits) rowById.set(h.id, h.row);
  for (const h of vecHits) rowById.set(h.id, h.row);

  let orderedIds: string[];
  let fusedBy: "rrf" | "weighted" | undefined;
  let rrfK: number | undefined;

  if (vecHits.length > 0) {
    const lists = new Map([
      ["bm25", bm25Hits.map(({ id, score, rank }) => ({ id, score, rank }))],
      ["vector", vecHits.map(({ id, score, rank }) => ({ id, score, rank }))],
    ]);
    const fused = fuseLists(lists, fuse);
    orderedIds = fused.hits.map((h) => h.id);
    fusedBy = fused.strategy;
    rrfK = fused.k;
  } else {
    orderedIds = bm25Hits.map((h) => h.id);
  }

  let data = orderedIds
    .slice(0, limit)
    .map((id) => rowById.get(id))
    .filter((r): r is SqlRow => r !== undefined);

  if (rerank && typeof rerank === "object" && rerank.model && deps.askRerank) {
    const docs = data.map((row) => {
      const id = String(row[pkSqlName] ?? row["id"] ?? "");
      const text = searchable.map((c) => String(row[c.sqlName] ?? "")).join("\n");
      return { id, text, score: 0 };
    });
    const out = await deps.askRerank(rerank.model, { query, docs });
    if (out.rankedIds && out.rankedIds.length > 0) {
      const byId = new Map(data.map((r) => [String(r[pkSqlName] ?? r["id"]), r]));
      data = out.rankedIds
        .map((id) => byId.get(id))
        .filter((r): r is SqlRow => r !== undefined);
    }
  }

  return {
    data,
    meta: {
      engine: engines,
      ...(fusedBy ? { fusedBy } : {}),
      ...(rrfK !== undefined ? { rrfK } : {}),
      limit,
    },
  };
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    return `"${name.replaceAll('"', '""')}"`;
  }
  return name;
}
