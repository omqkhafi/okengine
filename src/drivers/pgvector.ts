/**
 * `pgvector` driver — vector index facet over Postgres + pgvector.
 *
 * Real ANN via drizzle-orm's pg vector API: `vector(dims)` column, HNSW index
 * (`vector_cosine_ops`), `cosineDistance` ordering — no JS-side distance math
 * on the SQL path. One implementation serves both the `postgres` and `pglite`
 * sql drivers (identical wire dialect); the caller injects the already-open
 * {@link SqlConnection} (shared with `store.sql`, never a second connection).
 *
 * When no SQL connection is provided, falls back to an in-process cosine index
 * so the conformance suite runs without a live Postgres.
 */

import { cosineDistance } from "drizzle-orm";
import { PgDialect, index as pgIndex, pgTable, text, vector } from "drizzle-orm/pg-core";
import type {
  IndexHit,
  IndexOpenOptions,
  SqlConnection,
  VectorIndexDriver,
  VectorIndexStore,
} from "./types.ts";

/**
 * Open a pgvector-backed index.
 *
 * @param options - Name / dims / SQL connection
 */
export async function openPgvectorIndex(options: IndexOpenOptions): Promise<VectorIndexStore> {
  if (options.sql) {
    return openPgvectorSql(options.name, options.dims, options.sql);
  }
  // Conformance / offline without Postgres: same API, in-process vectors.
  return openPgvectorMemory(options.dims);
}

const pgDialect = new PgDialect();

async function openPgvectorSql(
  name: string,
  dims: number,
  sql: SqlConnection,
): Promise<VectorIndexStore> {
  if (sql.driverId !== "postgres" && sql.driverId !== "pglite") {
    throw new Error(
      `pgvector index: needs a postgres/pglite SQL connection, got "${sql.driverId}" — ` +
        `set store.sql to "postgres" or "pglite" so the index shares its connection`,
    );
  }

  const tableName = `oke_idx_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const indexName = `${tableName}_hnsw`;
  const table = pgTable(
    tableName,
    {
      id: text("id").primaryKey(),
      embedding: vector("embedding", { dimensions: dims }).notNull(),
      meta: text("meta"),
    },
    (t) => [pgIndex(indexName).using("hnsw", t.embedding.op("vector_cosine_ops"))],
  );

  // Extension + DDL — fail loud when pgvector is not installed (never fall back).
  await sql.exec(`CREATE EXTENSION IF NOT EXISTS vector`);
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (id TEXT PRIMARY KEY, embedding vector(${dims}) NOT NULL, meta TEXT)`,
  );
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" USING hnsw (embedding vector_cosine_ops)`,
  );

  return {
    driverId: "pgvector",
    async upsert(id, vec, meta) {
      if (vec.length !== dims) {
        throw new Error(`vector dims ${vec.length} !== index dims ${dims}`);
      }
      await sql.exec(
        `INSERT INTO "${tableName}" (id, embedding, meta) VALUES (?, ?::vector, ?) ` +
          `ON CONFLICT (id) DO UPDATE SET embedding = excluded.embedding, meta = excluded.meta`,
        [id, JSON.stringify(vec), meta ? JSON.stringify(meta) : null],
      );
    },
    async search(vec, topK = 10): Promise<IndexHit[]> {
      const distance = pgDialect.sqlToQuery(cosineDistance(table.embedding, [...vec]));
      const distanceSql = distance.sql.replace(/\$\d+/g, "?");
      const rows = await sql.query(
        `SELECT "id", "meta", ${distanceSql} AS "distance" FROM "${tableName}" ` +
          `ORDER BY "distance" ASC LIMIT ?`,
        [...distance.params, Math.max(1, Math.floor(topK))],
      );
      return rows.map((row) => {
        const metaRaw = row.meta;
        return {
          id: String(row.id),
          score: 1 - Number(row.distance),
          meta:
            typeof metaRaw === "string"
              ? (JSON.parse(metaRaw) as Record<string, unknown>)
              : undefined,
        };
      });
    },
    async delete(id) {
      const result = await sql.exec(`DELETE FROM "${tableName}" WHERE id = ?`, [id]);
      return result.changes > 0;
    },
    async close() {
      /* SQL connection owned by caller */
    },
  };
}

function openPgvectorMemory(dims: number): VectorIndexStore {
  const docs = new Map<string, { vector: number[]; meta?: Record<string, unknown> }>();
  return {
    driverId: "pgvector",
    async upsert(id, vector, meta) {
      if (vector.length !== dims) {
        throw new Error(`vector dims ${vector.length} !== index dims ${dims}`);
      }
      docs.set(id, { vector: [...vector], meta });
    },
    async search(vector, topK = 10): Promise<IndexHit[]> {
      const hits: IndexHit[] = [];
      for (const [id, doc] of docs) {
        hits.push({ id, score: cosine(vector, doc.vector), meta: doc.meta });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, topK);
    },
    async delete(id) {
      return docs.delete(id);
    },
    async close() {
      docs.clear();
    },
  };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Protocol-named pgvector driver. */
export const pgvectorDriver: VectorIndexDriver = {
  id: "pgvector",
  facet: "index",
  open: openPgvectorIndex,
};
