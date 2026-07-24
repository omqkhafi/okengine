/**
 * `memory` driver — in-process backends for sql · kv · files · index (test/dev).
 */

import type {
  FilesBucket,
  FilesDriver,
  FilesOpenOptions,
  IndexDriver,
  IndexHit,
  IndexOpenOptions,
  IndexStore,
  KvDriver,
  KvNamespace,
  KvOpenOptions,
  SqlConnectOptions,
  SqlConnection,
  SqlDriver,
  SqlRow,
} from "./types.ts";

/** In-memory SQL table. */
interface MemTable {
  columns: string[];
  rows: SqlRow[];
}

function createMemorySqlConnection(role: "primary" | "replica"): SqlConnection {
  const tables = new Map<string, MemTable>();

  function getTable(name: string): MemTable {
    const t = tables.get(name);
    if (!t) throw new Error(`no such table: ${name}`);
    return t;
  }

  function parseIdent(raw: string): string {
    return raw.replaceAll('"', "").trim();
  }

  return {
    driverId: "memory",
    role,
    async query(sql, params = []) {
      const text = sql.trim();
      const select = /^SELECT\s+\*\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*(?:WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?)?\s*$/i.exec(
        text,
      );
      if (select) {
        const table = getTable(parseIdent(select[1]!));
        if (select[2]) {
          const col = parseIdent(select[2]!);
          const want = params[0];
          return table.rows
            .filter((r) => r[col] === want)
            .map((r) => ({ ...r }));
        }
        return table.rows.map((r) => ({ ...r }));
      }

      const insertReturning =
        /^INSERT\s+INTO\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*RETURNING\s+\*\s*$/i.exec(
          text,
        );
      if (insertReturning) {
        const name = parseIdent(insertReturning[1]!);
        const table = getTable(name);
        const cols = insertReturning[2]!.split(",").map((c) => parseIdent(c));
        const row: SqlRow = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        table.rows.push(row);
        return [{ ...row }];
      }

      throw new Error(`memory sql: unsupported query: ${sql}`);
    },
    async exec(sql, params = []) {
      const text = sql.trim();
      const create =
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\((.+)\)\s*$/i.exec(
          text,
        );
      if (create) {
        const name = parseIdent(create[1]!);
        if (!tables.has(name)) {
          const colPart = create[2]!;
          const columns = colPart.split(",").map((part) => {
            const id = part.trim().split(/\s+/)[0]!;
            return parseIdent(id);
          });
          tables.set(name, { columns, rows: [] });
        }
        return { changes: 0 };
      }

      const insert =
        /^INSERT\s+INTO\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.exec(
          text,
        );
      if (insert) {
        const name = parseIdent(insert[1]!);
        const table = getTable(name);
        const cols = insert[2]!.split(",").map((c) => parseIdent(c));
        const row: SqlRow = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        table.rows.push(row);
        return { changes: 1 };
      }

      const del =
        /^DELETE\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?\s*$/i.exec(
          text,
        );
      if (del) {
        const table = getTable(parseIdent(del[1]!));
        const col = parseIdent(del[2]!);
        const before = table.rows.length;
        table.rows = table.rows.filter((r) => r[col] !== params[0]);
        return { changes: before - table.rows.length };
      }

      throw new Error(`memory sql: unsupported exec: ${sql}`);
    },
    async close() {
      tables.clear();
    },
  };
}

/** Memory SQL driver. */
export const memorySqlDriver: SqlDriver = {
  id: "memory",
  facet: "sql",
  async connect(options: SqlConnectOptions = {}) {
    return createMemorySqlConnection(options.role ?? "primary");
  },
};

/** Memory KV driver. */
export const memoryKvDriver: KvDriver = {
  id: "memory",
  facet: "kv",
  async open(options: KvOpenOptions): Promise<KvNamespace> {
    const store = new Map<string, unknown>();
    const prefix = `${options.name}:`;
    return {
      driverId: "memory",
      async get(key) {
        return store.get(prefix + key);
      },
      async set(key, value) {
        store.set(prefix + key, value);
      },
      async delete(key) {
        return store.delete(prefix + key);
      },
      async close() {
        store.clear();
      },
    };
  },
};

/** Memory files driver. */
export const memoryFilesDriver: FilesDriver = {
  id: "memory",
  facet: "files",
  async open(options: FilesOpenOptions): Promise<FilesBucket> {
    const objects = new Map<string, Uint8Array>();
    const prefix = `${options.name}/`;
    return {
      driverId: "memory",
      async put(key, data) {
        const bytes =
          typeof data === "string" ? new TextEncoder().encode(data) : data;
        objects.set(prefix + key, bytes);
      },
      async get(key) {
        return objects.get(prefix + key) ?? null;
      },
      async delete(key) {
        return objects.delete(prefix + key);
      },
      async list(listPrefix = "") {
        const full = prefix + listPrefix;
        return [...objects.keys()]
          .filter((k) => k.startsWith(full))
          .map((k) => k.slice(prefix.length));
      },
      async close() {
        objects.clear();
      },
    };
  },
};

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

/** Memory index driver. */
export const memoryIndexDriver: IndexDriver = {
  id: "memory",
  facet: "index",
  async open(options: IndexOpenOptions): Promise<IndexStore> {
    const docs = new Map<
      string,
      { vector: number[]; meta?: Record<string, unknown> }
    >();
    return {
      driverId: "memory",
      async upsert(id, vector, meta) {
        if (vector.length !== options.dims) {
          throw new Error(
            `vector dims ${vector.length} !== index dims ${options.dims}`,
          );
        }
        docs.set(id, { vector: [...vector], meta });
      },
      async search(vector, topK = 10): Promise<IndexHit[]> {
        const hits: IndexHit[] = [];
        for (const [id, doc] of docs) {
          hits.push({
            id,
            score: cosine(vector, doc.vector),
            meta: doc.meta,
          });
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
  },
};

/**
 * Convenience bundle of all memory facet drivers.
 */
export const memoryDrivers = {
  sql: memorySqlDriver,
  kv: memoryKvDriver,
  files: memoryFilesDriver,
  index: memoryIndexDriver,
} as const;
