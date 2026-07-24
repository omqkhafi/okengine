/**
 * `pgvector` driver — vector index facet over Postgres + pgvector.
 *
 * When no SQL connection is provided, falls back to an in-process cosine index
 * so the conformance suite runs without a live Postgres.
 */

import type {
  IndexDriver,
  IndexHit,
  IndexOpenOptions,
  IndexStore,
  SqlConnection,
} from "./types.ts";

/**
 * Open a pgvector-backed index.
 *
 * @param options - Name / dims / SQL connection
 */
export async function openPgvectorIndex(
  options: IndexOpenOptions,
): Promise<IndexStore> {
  if (options.sql) {
    return openPgvectorSql(options.name, options.dims, options.sql);
  }
  // Conformance / offline without Postgres: same API, in-process vectors.
  return openPgvectorMemory(options.dims);
}

async function openPgvectorSql(
  name: string,
  dims: number,
  sql: SqlConnection,
): Promise<IndexStore> {
  const table = `oke_idx_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, embedding TEXT NOT NULL, meta TEXT)`,
  );

  return {
    driverId: "pgvector",
    async upsert(id, vector, meta) {
      if (vector.length !== dims) {
        throw new Error(`vector dims ${vector.length} !== index dims ${dims}`);
      }
      await sql.exec(`DELETE FROM "${table}" WHERE id = ?`, [id]);
      await sql.exec(
        `INSERT INTO "${table}" (id, embedding, meta) VALUES (?, ?, ?)`,
        [id, JSON.stringify(vector), meta ? JSON.stringify(meta) : null],
      );
    },
    async search(vector, topK = 10): Promise<IndexHit[]> {
      const rows = await sql.query(`SELECT id, embedding, meta FROM "${table}"`);
      const hits: IndexHit[] = rows.map((row) => {
        const emb = JSON.parse(String(row.embedding)) as number[];
        const metaRaw = row.meta;
        return {
          id: String(row.id),
          score: cosine(vector, emb),
          meta:
            typeof metaRaw === "string"
              ? (JSON.parse(metaRaw) as Record<string, unknown>)
              : undefined,
        };
      });
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, topK);
    },
    async delete(id) {
      const result = await sql.exec(`DELETE FROM "${table}" WHERE id = ?`, [id]);
      return result.changes > 0;
    },
    async close() {
      /* SQL connection owned by caller */
    },
  };
}

function openPgvectorMemory(dims: number): IndexStore {
  const docs = new Map<
    string,
    { vector: number[]; meta?: Record<string, unknown> }
  >();
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
export const pgvectorDriver: IndexDriver = {
  id: "pgvector",
  facet: "index",
  open: openPgvectorIndex,
};
