/**
 * `memory` driver — in-process backends for sql · kv · files · index (test/dev).
 */

import { LuaKvStore } from "./kv-lua.ts";
import type {
  FilesBucket,
  FilesDriver,
  FilesOpenOptions,
  IndexHit,
  IndexOpenOptions,
  VectorIndexDriver,
  VectorIndexStore,
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

      const countStar =
        /^SELECT\s+COUNT\(\*\)\s+AS\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*(?:WHERE\s+(.+?))?\s*$/i.exec(
          text,
        );
      if (countStar) {
        const table = getTable(parseIdent(countStar[1]!));
        const whereClause = countStar[2]?.trim();
        let rows = table.rows;
        if (whereClause) {
          const ast = parseWhere(whereClause);
          rows = rows.filter((r) => evalWhere(ast, r, params, { i: 0 }));
        }
        return [{ count: rows.length }];
      }

      const selectGeneric =
        /^SELECT\s+(.+?)\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*(?:WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*$/i.exec(
          text,
        );
      if (selectGeneric && !/^\s*1\s+AS\s+/i.test(selectGeneric[1]!)) {
        const table = getTable(parseIdent(selectGeneric[2]!));
        const selectList = selectGeneric[1]!.trim();
        const whereClause = selectGeneric[3]?.trim();
        const orderClause = selectGeneric[4]?.trim();
        const limit = selectGeneric[5] ? Number(selectGeneric[5]) : undefined;
        const offset = selectGeneric[6] ? Number(selectGeneric[6]) : undefined;
        let rows = table.rows.map((r) => ({ ...r }));
        if (whereClause) {
          const ast = parseWhere(whereClause);
          rows = rows.filter((r) => evalWhere(ast, r, params, { i: 0 }));
        }
        if (orderClause) {
          const terms = parseOrderTerms(orderClause);
          rows = [...rows].sort((a, b) => compareByTerms(a, b, terms));
        }
        if (offset !== undefined) rows = rows.slice(offset);
        if (limit !== undefined) rows = rows.slice(0, limit);
        if (selectList === "*") return rows;
        const cols = selectList.split(",").map((part) => {
          const as =
            /^\s*("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+AS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*$/i.exec(part);
          if (as) {
            return { sql: parseIdent(as[1]!), alias: parseIdent(as[2]!) };
          }
          const name = parseIdent(part.trim());
          return { sql: name, alias: name };
        });
        return rows.map((r) => {
          const out: SqlRow = {};
          for (const c of cols) out[c.alias] = r[c.sql];
          return out;
        });
      }

      const exists =
        /^SELECT\s+1\s+AS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+WHERE\s+(.+?)\s+LIMIT\s+1\s*$/i.exec(
          text,
        );
      if (exists) {
        const table = getTable(parseIdent(exists[2]!));
        const preds = parseEqualityWhere(exists[3]!);
        const hit = table.rows.some((r) => preds.every((p, i) => r[p] === params[i]));
        return hit ? [{ [parseIdent(exists[1]!)]: 1 }] : [];
      }

      const updateReturning =
        /^UPDATE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+SET\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\+\s*\?\s+WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?\s+RETURNING\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*$/i.exec(
          text,
        );
      if (updateReturning) {
        const table = getTable(parseIdent(updateReturning[1]!));
        const setCol = parseIdent(updateReturning[2]!);
        const addCol = parseIdent(updateReturning[3]!);
        const whereCol = parseIdent(updateReturning[4]!);
        const retCol = parseIdent(updateReturning[5]!);
        if (setCol !== addCol || setCol !== retCol) {
          throw new Error(`memory sql: unsupported query: ${sql}`);
        }
        const delta = Number(params[0]);
        const idValue = params[1];
        const row = table.rows.find((r) => r[whereCol] === idValue);
        if (!row) return [];
        const next = Number(row[setCol] ?? 0) + delta;
        row[setCol] = next;
        return [{ [retCol]: next }];
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

      const delLt =
        /^DELETE\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*<\s*\?\s*$/i.exec(
          text,
        );
      if (delLt) {
        const table = getTable(parseIdent(delLt[1]!));
        const col = parseIdent(delLt[2]!);
        const cutoff = Number(params[0]);
        const before = table.rows.length;
        table.rows = table.rows.filter((r) => Number(r[col] ?? 0) >= cutoff);
        return { changes: before - table.rows.length };
      }

      const updateIncAnd =
        /^UPDATE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+SET\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\+\s*1\s+WHERE\s+(.+)\s*$/i.exec(
          text,
        );
      if (updateIncAnd) {
        const table = getTable(parseIdent(updateIncAnd[1]!));
        const setCol = parseIdent(updateIncAnd[2]!);
        const addCol = parseIdent(updateIncAnd[3]!);
        if (setCol !== addCol) {
          throw new Error(`memory sql: unsupported exec: ${sql}`);
        }
        const preds = parseEqualityWhere(updateIncAnd[4]!);
        const row = table.rows.find((r) => preds.every((p, i) => r[p] === params[i]));
        if (!row) return { changes: 0 };
        row[setCol] = Number(row[setCol] ?? 0) + 1;
        return { changes: 1 };
      }

      const updateSet =
        /^UPDATE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+SET\s+(.+?)\s+WHERE\s+(.+)\s*$/i.exec(text);
      if (updateSet) {
        const table = getTable(parseIdent(updateSet[1]!));
        const setParts = updateSet[2]!.split(",").map((p) => p.trim());
        const setCols = setParts.map((part) => {
          const m = /^("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?$/.exec(part);
          if (!m) throw new Error(`memory sql: unsupported SET: ${part}`);
          return parseIdent(m[1]!);
        });
        const ast = parseWhere(updateSet[3]!);
        const row = table.rows.find((r) => evalWhere(ast, r, params, { i: setCols.length }));
        if (!row) return { changes: 0 };
        setCols.forEach((col, i) => {
          row[col] = params[i];
        });
        return { changes: 1 };
      }

      throw new Error(`memory sql: unsupported exec: ${sql}`);
    },
    async close() {
      tables.clear();
    },
  };
}

/** One comparison operator for the memory SQL driver. */
type WhereOp =
  | "="
  | "<"
  | ">"
  | "<="
  | ">="
  | "!="
  | "like"
  | "ilike"
  | "in"
  | "is null"
  | "is not null";

/** WHERE condition AST node — leaf comparison or AND/OR group. */
type WhereNode =
  | { readonly kind: "cmp"; readonly column: string; readonly op: WhereOp; readonly arity: number }
  | { readonly kind: "and"; readonly children: readonly WhereNode[] }
  | { readonly kind: "or"; readonly children: readonly WhereNode[] };

/** One `ORDER BY` term. */
interface OrderTerm {
  readonly column: string;
  readonly direction: "ASC" | "DESC";
}

/**
 * Parse a WHERE clause into an AST. Supports parenthesized groups, `AND` /
 * `OR`, binary comparisons, and `like` / `ilike` — the shapes the store
 * session compiler emits. Anything else throws.
 *
 * @param clause - WHERE text (without the `WHERE` keyword)
 */
function parseWhere(clause: string): WhereNode {
  const tokens = tokenizeWhere(clause);
  const unsupported = (): Error => new Error(`memory sql: unsupported WHERE: ${clause}`);
  let pos = 0;

  const peek = (): string | undefined => tokens[pos];
  const parseLevel = (keyword: "AND" | "OR", down: () => WhereNode): WhereNode => {
    const first = down();
    if (peek()?.toUpperCase() !== keyword) return first;
    const rest: WhereNode[] = [];
    do {
      pos++;
      rest.push(down());
    } while (peek()?.toUpperCase() === keyword);
    const children = [first, ...rest];
    return keyword === "AND" ? { kind: "and", children } : { kind: "or", children };
  };
  const parseFactor = (): WhereNode => {
    if (peek() === "(") {
      pos++;
      const node = parseLevel("OR", () => parseLevel("AND", parseFactor));
      if (peek() !== ")") throw unsupported();
      pos++;
      return node;
    }
    const colTok = tokens[pos++];
    const opTok = tokens[pos++];
    if (colTok === undefined || opTok === undefined) throw unsupported();
    if (opTok.toLowerCase() === "is") {
      const second = tokens[pos++]?.toLowerCase();
      const nullOp =
        second === "null"
          ? "is null"
          : second === "not" && tokens[pos++]?.toLowerCase() === "null"
            ? "is not null"
            : undefined;
      if (nullOp === undefined) throw unsupported();
      return { kind: "cmp", column: colTok.replaceAll('"', "").trim(), op: nullOp, arity: 0 };
    }
    if (opTok.toLowerCase() === "in") {
      if (peek() !== "(") throw unsupported();
      pos++;
      let arity = 0;
      while (peek() === "?") {
        arity++;
        pos++;
        if (peek() === ",") pos++;
      }
      if (arity === 0 || peek() !== ")") throw unsupported();
      pos++;
      return { kind: "cmp", column: colTok.replaceAll('"', "").trim(), op: "in", arity };
    }
    const paramTok = tokens[pos++];
    if (paramTok !== "?") throw unsupported();
    const op = asWhereOp(opTok);
    if (op === undefined) throw unsupported();
    return { kind: "cmp", column: colTok.replaceAll('"', "").trim(), op, arity: 1 };
  };

  const node = parseLevel("OR", () => parseLevel("AND", parseFactor));
  if (pos !== tokens.length) throw unsupported();
  return node;
}

function tokenizeWhere(clause: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < clause.length) {
    const ch = clause[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "?" || ch === ",") {
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '"') {
      const end = clause.indexOf('"', i + 1);
      if (end === -1) throw new Error(`memory sql: unsupported WHERE: ${clause}`);
      out.push(clause.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    const two = clause.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "!=") {
      out.push(two);
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "<" || ch === ">") {
      out.push(ch);
      i++;
      continue;
    }
    const word = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(clause.slice(i));
    if (word) {
      out.push(word[0]);
      i += word[0].length;
      continue;
    }
    throw new Error(`memory sql: unsupported WHERE: ${clause}`);
  }
  return out;
}

function asWhereOp(token: string): WhereOp | undefined {
  switch (token.toLowerCase()) {
    case "=":
      return "=";
    case "<":
      return "<";
    case ">":
      return ">";
    case "<=":
      return "<=";
    case ">=":
      return ">=";
    case "!=":
    case "<>":
      return "!=";
    case "like":
      return "like";
    case "ilike":
      return "ilike";
    default:
      return undefined;
  }
}

/** Evaluate a WHERE AST against a row, consuming `?` params in order. */
function evalWhere(
  node: WhereNode,
  row: SqlRow,
  params: readonly unknown[],
  state: { i: number },
): boolean {
  if (node.kind === "and") {
    return node.children.every((c) => evalWhere(c, row, params, state));
  }
  if (node.kind === "or") {
    return node.children.some((c) => evalWhere(c, row, params, state));
  }
  if (node.op === "is null") {
    return row[node.column] === null || row[node.column] === undefined;
  }
  if (node.op === "is not null") {
    return row[node.column] !== null && row[node.column] !== undefined;
  }
  if (node.op === "in") {
    const wants = params.slice(state.i, state.i + node.arity);
    state.i += node.arity;
    return wants.some((w) => compareRow(row[node.column], w, "="));
  }
  const want = params[state.i++];
  return compareRow(row[node.column], want, node.op);
}

/** Parse `col = ? AND col2 = ?` into ordered column names (equality-only). */
function parseEqualityWhere(clause: string): string[] {
  const node = parseWhere(clause);
  const cols: string[] = [];
  const walk = (n: WhereNode): void => {
    if (n.kind === "and") {
      n.children.forEach(walk);
      return;
    }
    if (n.kind === "or" || n.op !== "=") {
      throw new Error(`memory sql: unsupported WHERE: ${clause}`);
    }
    cols.push(n.column);
  };
  walk(node);
  return cols;
}

/** Parse `"a" DESC, "b"` into ordered terms (default ASC). */
function parseOrderTerms(clause: string): OrderTerm[] {
  return clause.split(",").map((part) => {
    const m = /^\s*("?[a-zA-Z_][a-zA-Z0-9_]*"?)(?:\s+(ASC|DESC))?\s*$/i.exec(part);
    if (!m) throw new Error(`memory sql: unsupported ORDER BY: ${clause}`);
    return {
      column: m[1]!.replaceAll('"', "").trim(),
      direction: (m[2]?.toUpperCase() ?? "ASC") as OrderTerm["direction"],
    };
  });
}

function compareByTerms(a: SqlRow, b: SqlRow, terms: readonly OrderTerm[]): number {
  for (const term of terms) {
    const av = a[term.column];
    const bv = b[term.column];
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    }
    if (cmp !== 0) return term.direction === "DESC" ? -cmp : cmp;
  }
  return 0;
}

function compareRow(cell: unknown, want: unknown, op: WhereOp): boolean {
  if (op === "=") return cell === want;
  if (op === "!=") return cell !== want;
  // sqlite parity: LIKE is case-insensitive for ASCII; ILIKE matches it.
  if (op === "like" || op === "ilike") return likeMatch(cell, want);
  let cmp: number;
  if (typeof cell === "number" && typeof want === "number") {
    cmp = cell - want;
  } else if (typeof cell === "string" && typeof want === "string") {
    cmp = cell.localeCompare(want);
  } else {
    cmp = Number(cell ?? 0) - Number(want ?? 0);
  }
  switch (op) {
    case "<":
      return cmp < 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case ">=":
      return cmp >= 0;
    default:
      return false;
  }
}

function likeMatch(cell: unknown, pattern: unknown): boolean {
  const text = String(cell ?? "");
  const source = String(pattern ?? "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${source}$`, "i").test(text);
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
    const lua = new LuaKvStore(options.nowMs);
    /** Serialize EVAL so concurrent rate checks stay atomic. */
    let evalChain: Promise<unknown> = Promise.resolve();
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
      async list(listPrefix = "") {
        const full = prefix + listPrefix;
        return [...store.keys()]
          .filter((k) => k.startsWith(full))
          .map((k) => k.slice(prefix.length))
          .sort();
      },
      async eval<T = unknown>(
        script: string,
        keys: readonly string[],
        args: readonly string[] = [],
      ): Promise<T> {
        const run = evalChain.then(() =>
          lua.eval(
            script,
            keys.map((k) => prefix + k),
            args,
          ),
        );
        evalChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run as Promise<T>;
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
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
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
export const memoryIndexDriver: VectorIndexDriver = {
  id: "memory",
  facet: "index",
  async open(options: IndexOpenOptions): Promise<VectorIndexStore> {
    const docs = new Map<string, { vector: number[]; meta?: Record<string, unknown> }>();
    return {
      driverId: "memory",
      async upsert(id, vector, meta) {
        if (vector.length !== options.dims) {
          throw new Error(`vector dims ${vector.length} !== index dims ${options.dims}`);
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
