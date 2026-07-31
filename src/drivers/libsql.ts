/**
 * `libsql` driver — binds `@libsql/client` (optional peer, dynamic import).
 *
 * Protocol-named: libSQL speaks the sqlite wire dialect plus native ANN
 * vectors (`F32_BLOB` + `libsql_vector_idx` + `vector_top_k`). Classic libSQL
 * only — never the Turso Rust rewrite (`@tursodatabase/database`).
 *
 * Serves both the `sql` facet (same `?` placeholder convention as `sqlite`)
 * and the `index` facet (native ANN, no JS-side distance math).
 *
 * Latency note: local file / `:memory:` opens are in-process like sqlite.
 */

import { customType, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  IndexHit,
  IndexOpenOptions,
  SqlConnectOptions,
  SqlConnection,
  SqlDriver,
  SqlRow,
  VectorIndexDriver,
  VectorIndexStore,
} from "./types.ts";

/** `@libsql/client` is an optional peer — loaded only when this driver runs. */
type LibsqlModule = typeof import("@libsql/client");

async function loadLibsql(): Promise<LibsqlModule> {
  try {
    return await import("@libsql/client");
  } catch {
    throw new Error(
      "libsql driver: install optional peer `@libsql/client` (bun add @libsql/client)",
    );
  }
}

/** Bare file paths become `file:` URLs; `:memory:` / scheme URLs pass through. */
function normalizeLibsqlUrl(url: string): string {
  if (url === ":memory:" || url.includes("://") || url.startsWith("file:")) return url;
  return `file:${url}`;
}

/**
 * Open a libSQL connection implementing {@link SqlConnection}.
 *
 * @param options - URL (`:memory:` / `file:…` / `libsql://…`) / role
 */
export async function connectLibsql(options: SqlConnectOptions = {}): Promise<SqlConnection> {
  const role = options.role ?? "primary";
  const { createClient } = await loadLibsql();
  const client = createClient({ url: normalizeLibsqlUrl(options.url ?? ":memory:") });
  return {
    driverId: "libsql",
    role,
    async query(sql, params = []) {
      const rs = await client.execute({ sql, args: params as never });
      return rs.rows as unknown as SqlRow[];
    },
    async exec(sql, params = []) {
      const rs = await client.execute({ sql, args: params as never });
      return { changes: rs.rowsAffected };
    },
    async close() {
      client.close();
    },
  };
}

/** Protocol-named libsql sql driver. */
export const libsqlDriver: SqlDriver = {
  id: "libsql",
  facet: "sql",
  connect: connectLibsql,
};

/** libSQL native vector column: `F32_BLOB(dims)` (float32, validated by the engine). */
const f32Blob = customType<{
  data: readonly number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `F32_BLOB(${config?.dimensions ?? 0})`;
  },
  toDriver(value) {
    return JSON.stringify(value);
  },
});

/**
 * Open a libSQL-backed index with native ANN.
 *
 * DDL: `F32_BLOB(dims)` column + `libsql_vector_idx` ANN index (validated
 * against `@libsql/client@0.17`). Queries run `vector_top_k` joined back to
 * the base table — approximate nearest neighbours, never a full scan. Score
 * is cosine similarity (`1 - vector_distance_cos`), matching the memory
 * driver's higher-is-better convention.
 *
 * @param options - Name / dims / shared SQL connection
 */
export async function openLibsqlIndex(options: IndexOpenOptions): Promise<VectorIndexStore> {
  const ownsSql = !options.sql;
  const sql = options.sql ?? (await connectLibsql({ url: options.url }));
  if (sql.driverId !== "libsql") {
    if (ownsSql) await sql.close();
    throw new Error(
      `libsql index: needs a libsql SQL connection, got "${sql.driverId}" — ` +
        `set store.sql to "libsql" so the index shares its connection`,
    );
  }

  const tableName = `oke_idx_${options.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const indexName = `${tableName}_vec`;
  const table = sqliteTable(tableName, {
    id: text("id").primaryKey(),
    embedding: f32Blob("embedding", { dimensions: options.dims }).notNull(),
    meta: text("meta"),
  });

  await sql.exec(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (id TEXT PRIMARY KEY, embedding ${table.embedding.getSQLType()} NOT NULL, meta TEXT)`,
  );
  // ANN index — fails loud on engines without vector support (never falls back).
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (libsql_vector_idx(embedding))`,
  );

  return {
    driverId: "libsql",
    async upsert(id, vector, meta) {
      if (vector.length !== options.dims) {
        throw new Error(`vector dims ${vector.length} !== index dims ${options.dims}`);
      }
      await sql.exec(
        `INSERT INTO "${tableName}" (id, embedding, meta) VALUES (?, vector32(?), ?) ` +
          `ON CONFLICT (id) DO UPDATE SET embedding = excluded.embedding, meta = excluded.meta`,
        [id, JSON.stringify(vector), meta ? JSON.stringify(meta) : null],
      );
    },
    async search(vector, topK = 10): Promise<IndexHit[]> {
      const k = Math.max(1, Math.floor(topK));
      const rows = await sql.query(
        `SELECT t.id AS id, t.meta AS meta, ` +
          `vector_distance_cos(t.embedding, vector32(?)) AS distance ` +
          `FROM vector_top_k('${indexName}', vector32(?), ${k}) AS i ` +
          `JOIN "${tableName}" AS t ON t.rowid = i.id ` +
          `ORDER BY distance ASC`,
        [JSON.stringify(vector), JSON.stringify(vector)],
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
      if (ownsSql) await sql.close();
    },
  };
}

/** Protocol-named libsql index driver. */
export const libsqlIndexDriver: VectorIndexDriver = {
  id: "libsql",
  facet: "index",
  open: openLibsqlIndex,
};
