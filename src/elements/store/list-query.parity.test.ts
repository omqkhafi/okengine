/**
 * parseList extraction parity (Realtime Round 2 gate):
 *
 * The PostgREST list grammar parser was extracted from the `store.resource`
 * factory closure into `parseListQuery` (list-query.ts). This suite proves
 * the extraction is behavior-identical:
 *
 *  1. Dual-path parity — the SAME query matrix runs through the resource's
 *     own parse path (`resourceR.page()` / thrown failure JSON) and through
 *     the standalone `parseListQuery(resolveListScope(...).query, ...)`;
 *     every compiled where/order/limit/cursor and every failure shape must
 *     deep-equal.
 *  2. Committed golden — `OKE_MINT_LIST_GOLDEN=1 bun test` re-mints
 *     `list-query.golden.json` from the resource path; CI compares against
 *     the committed file, so any future drift in either path fails loudly.
 *  3. Real-SQL e2e — identical URLs answered through both parse paths over
 *     pglite return identical rows and totals.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { compileWhere } from "./sql-condition.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import { parseListQuery, resolveListScope, type ListQueryResult } from "./list-query.ts";
import { store } from "../store.ts";

const MINT = process.env.OKE_MINT_LIST_GOLDEN === "1";
const GOLDEN_PATH = join(import.meta.dir, "list-query.golden.json");

/** Shared table — offset + cursor configs exercise every grammar arm. */
const items = pgTable("parity_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  priority: integer("priority").notNull(),
  createdAt: integer("created_at").notNull(),
});

const OFFSET_CONFIG = {
  mode: "offset",
  search: [items.title],
  filter: "all",
  order: "all",
  select: "all",
  limit: 5,
  maxLimit: 10,
} as const;

const CURSOR_CONFIG = {
  mode: "cursor",
  cursor: [items.createdAt, items.id],
  direction: "desc",
  filter: "all",
  order: "all",
  limit: 5,
  maxLimit: 10,
} as const;

/** Cursor mode with NO cursor columns — `?cursor=` must fail "not configured". */
const CURSOR_UNCONFIGURED_CONFIG = {
  mode: "cursor",
  filter: "all",
  order: "all",
} as const;

/** Build a resource instance per config — the BEFORE path (internal parseList). */
function resourceFor(config: Record<string, unknown>) {
  const db = store.sql("parity", { schema: { items } });
  return store.resource(db, items, {
    in: { unknown: true } as never,
    out: { unknown: true } as never,
    list: config as never,
  });
}

const offsetR = resourceFor(OFFSET_CONFIG);
const cursorR = resourceFor(CURSOR_CONFIG);
const cursorUnconfiguredR = resourceFor(CURSOR_UNCONFIGURED_CONFIG);

const offsetScope = resolveListScope(items, OFFSET_CONFIG).query;
const cursorScope = resolveListScope(items, CURSOR_CONFIG).query;
const cursorUnconfiguredScope = resolveListScope(items, CURSOR_UNCONFIGURED_CONFIG).query;

/* ———————————————————— deterministic serializers ———————————————————— */

/** Serialize a drizzle-shaped SqlOp tree into stable text (columns by key). */
function serializeOp(op: unknown): string {
  if (op === undefined || op === null) return "undefined";
  const chunks = (op as { queryChunks?: readonly unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return JSON.stringify(op);
  const keyByColumn = new Map<unknown, string>();
  for (const [key, col] of Object.entries(items)) keyByColumn.set(col, key);
  return (
    "[" +
    chunks
      .map((chunk) => {
        if (chunk === null || chunk === undefined) return "nil";
        if (typeof chunk !== "object") return String(chunk);
        const c = chunk as { constructor?: { name?: string }; value?: unknown };
        if (c.constructor?.name === "StringChunk" && Array.isArray(c.value)) {
          return `T(${JSON.stringify(c.value[0])})`;
        }
        if ("value" in c && Array.isArray(c.value)) {
          return `P(${c.value.map((v) => JSON.stringify(v)).join(",")})`;
        }
        const colKey = keyByColumn.get(chunk);
        if (colKey !== undefined) return `C(${colKey})`;
        if (Array.isArray((chunk as { queryChunks?: unknown }).queryChunks)) {
          return serializeOp(chunk);
        }
        return `?${JSON.stringify(Object.keys(chunk as object))}`;
      })
      .join(", ") +
    "]"
  );
}

/** Serialize a where condition into stable JSON via the real SQL compiler. */
function whereSnapshot(where: unknown): unknown {
  if (where === undefined) return undefined;
  const compiled = compileWhere(where);
  if (compiled.clause === "") return undefined;
  // Compile per-chunk: map drizzle columns to stable JS keys.
  const keyByColumn = new Map<unknown, string>();
  for (const [key, col] of Object.entries(items)) keyByColumn.set(col, key);
  return {
    clause: compiled.clause.replace(/\?[a-zA-Z_][a-zA-Z0-9_]*/g, "?"),
    params: compiled.params,
    predicates: compiled.predicates.map((p) => ({
      column:
        keyByColumn.get(
          Array.from(keyByColumn.keys()).find(
            (col) => (col as { name?: string }).name === p.column,
          ),
        ) ?? p.column,
      op: p.op,
      value: p.value,
    })),
  };
}

/** Compact a parse result (ok or failure) into a JSON-stable snapshot node. */
function snapshotOf(result: ListQueryResult): unknown {
  if (!result.ok) {
    return { ok: false, failure: JSON.parse(JSON.stringify(result.failure)) as unknown };
  }
  const page = result.page as Record<string, unknown>;
  return {
    ok: true,
    where: whereSnapshot(page.where),
    orderBy: Array.isArray(page.orderBy) ? page.orderBy.map(serializeOp) : undefined,
    limit: page.limit,
    offset: page.offset,
    after: page.after === undefined ? undefined : serializeOp(page.after),
    before: page.before === undefined ? undefined : serializeOp(page.before),
    meta: result.meta,
    select: result.select?.map((c) => c.key),
    cursorDir: result.cursorDir,
  };
}

/** Run one input through the resource's internal parse path (BEFORE side). */
function viaResource(r: ReturnType<typeof resourceFor>, input: unknown): unknown {
  try {
    const page = r.page(input) as unknown as Record<string, unknown>;
    const { meta, ...rest } = page;
    return snapshotOf({ ok: true, page: rest, meta: meta as Record<string, unknown> });
  } catch (error) {
    const message = error instanceof TypeError ? error.message : String(error);
    const marker = "resource.page: invalid list input — ";
    const inner = message.startsWith(marker) ? message.slice(marker.length) : message;
    return { ok: false, failure: JSON.parse(inner) as unknown };
  }
}

/** Drop side-only metadata (`def.page` does not surface select/cursorDir). */
function commonOf(node: unknown): unknown {
  const n = node as Record<string, unknown>;
  const { select: _select, cursorDir: _cursorDir, ...rest } = n;
  return rest;
}

/* —————————————————————————— the query matrix —————————————————————————— */

const OFFSET_CASES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["default (no params)", {}],
  ["eq", { status: "eq.open" }],
  ["neq", { status: "neq.open" }],
  ["not.eq inversion", { status: "not.eq.open" }],
  ["gte", { priority: "gte.3" }],
  ["lt", { priority: "lt.5" }],
  ["like pattern", { title: "like.*task*" }],
  ["ilike pattern", { title: "ilike.*URGENT*" }],
  ["in list", { status: 'in.(open,done,"in,review")' }],
  ["is null", { title: "is.null" }],
  ["is true", { title: "is.true" }],
  ["or group", { or: "(status.eq.open,priority.gt.5)" }],
  ["and group", { and: "(status.eq.open,title.ilike.*urgent*)" }],
  ["nested not.or group", { or: "(status.eq.open,not.or(priority.lt.1,title.eq.x))" }],
  ["search", { search: "task" }],
  ["q alias", { q: "task" }],
  ["order multi desc", { order: "priority.desc,createdAt.asc" }],
  ["select projection", { select: "id,title" }],
  ["limit", { limit: "3" }],
  ["offset", { offset: "4" }],
  ["offset cursor token", { cursor: btoa(JSON.stringify({ k: "off", o: 4 })) }],
  [
    "combined",
    { status: "eq.open", order: "priority.desc", limit: "3", offset: "2", select: "id,status" },
  ],
  ["headers/cookie ignored", { headers: "x", cookie: "y", status: "eq.open" }],
];

const CURSOR_CASES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["default (cursor order implied)", {}],
  ["keyset after", { cursor: btoa(JSON.stringify({ v: [100, "i5"], d: "after" })) }],
  ["keyset before (flipped)", { cursor: btoa(JSON.stringify({ v: [100, "i5"], d: "before" })) }],
  ["bare array cursor (legacy after)", { cursor: btoa(JSON.stringify([100, "i5"])) }],
  [
    "filter + cursor",
    { status: "eq.open", cursor: btoa(JSON.stringify({ v: [100, "i5"], d: "after" })) },
  ],
];

const OFFSET_FAILURES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["unknown list param (filter none)", { secret: "eq.x" }],
  ["unknown or unfilterable column", { ghost: "eq.x" }],
  ["unsupported filter op", { status: "regex.x" }],
  ["missing op.value", { status: "open" }],
  ["bad is value", { title: "is.maybe" }],
  ["in without parens", { status: "in.open" }],
  ["in empty", { status: "in.()" }],
  ["search + q both", { search: "a", q: "b" }],
  ["bad limit", { limit: "0" }],
  ["bad offset", { offset: "-1" }],
  ["invalid cursor", { cursor: "!!!" }],
  ["bad order term", { order: "priority..desc" }],
  ["unknown order column", { order: "ghost.asc" }],
  ["unknown select column", { select: "ghost" }],
];

const CURSOR_FAILURES: ReadonlyArray<
  [string, Record<string, unknown>, "unconfigured" | "configured"]
> = [
  [
    "cursor pagination not configured",
    { cursor: btoa(JSON.stringify({ v: [100, "i5"], d: "after" })) },
    "unconfigured",
  ],
  [
    "cursor with wrong arity",
    { cursor: btoa(JSON.stringify({ v: [100], d: "after" })) },
    "configured",
  ],
  ["garbage cursor", { cursor: "not-even-base64" }, "configured"],
];

/* ———————————————————————————— the parity suite ——————————————————————————— */

describe("parseListQuery — extraction parity vs resource's internal parseList", () => {
  const golden: Record<string, unknown> = {};

  test("offset-mode matrix — both paths agree, golden matches", () => {
    for (const [name, input] of OFFSET_CASES) {
      const before = viaResource(offsetR, input);
      const after = snapshotOf(parseListQuery(input, offsetScope));
      expect(commonOf(after)).toEqual(commonOf(before));
      golden[`offset:${name}`] = after;
    }
  });

  test("cursor-mode matrix — both paths agree, golden matches", () => {
    for (const [name, input] of CURSOR_CASES) {
      const before = viaResource(cursorR, input);
      const after = snapshotOf(parseListQuery(input, cursorScope));
      expect(commonOf(after)).toEqual(commonOf(before));
      golden[`cursor:${name}`] = after;
    }
  });

  test("offset-mode failure shapes — both paths agree, golden matches", () => {
    for (const [name, input] of OFFSET_FAILURES) {
      const before = viaResource(offsetR, input);
      expect((before as { ok: boolean }).ok).toBe(false);
      const after = snapshotOf(parseListQuery(input, offsetScope));
      expect(after).toEqual(before);
      golden[`offset-fail:${name}`] = after;
    }
  });

  test("cursor-mode failure shapes — both paths agree, golden matches", () => {
    for (const [name, input, side] of CURSOR_FAILURES) {
      const resource = side === "configured" ? cursorR : cursorUnconfiguredR;
      const scope = side === "configured" ? cursorScope : cursorUnconfiguredScope;
      const before = viaResource(resource, input);
      expect((before as { ok: boolean }).ok).toBe(false);
      const after = snapshotOf(parseListQuery(input, scope));
      expect(after).toEqual(before);
      golden[`cursor-fail:${name}`] = after;
    }
  });

  test("committed golden matches", () => {
    if (MINT) {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
      expect(existsSync(GOLDEN_PATH)).toBe(true);
      return;
    }
    expect(existsSync(GOLDEN_PATH)).toBe(true);
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>;
    expect(golden).toEqual(committed);
  });

  test("select + cursorDir metadata (standalone-side assertions)", () => {
    const withSelect = parseListQuery({ select: "id,title" }, offsetScope);
    expect(withSelect.ok).toBe(true);
    if (withSelect.ok) {
      expect(withSelect.select?.map((c) => c.key)).toEqual(["id", "title"]);
    }
    const withBefore = parseListQuery(
      { cursor: btoa(JSON.stringify({ v: [100, "i5"], d: "before" })) },
      cursorScope,
    );
    expect(withBefore.ok).toBe(true);
    if (withBefore.ok) expect(withBefore.cursorDir).toBe("before");
  });
});

/* —————————————————————————— real-SQL e2e parity —————————————————————————— */

describe("parseListQuery — identical URLs, identical rows (pglite e2e)", () => {
  let conn: SqlConnection;
  let handle: SqlStoreHandle;

  beforeAll(async () => {
    conn = await pgliteDriver.connect({ url: "memory://parity-items", role: "primary" });
    handle = createSqlStoreHandle("sql:parity", {
      connection: conn,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "ensure",
    });
    await handle
      .insert(items)
      .values({ id: "i1", title: "alpha task", status: "open", priority: 1, createdAt: 100 });
    await handle
      .insert(items)
      .values({ id: "i2", title: "beta task", status: "done", priority: 5, createdAt: 200 });
    await handle
      .insert(items)
      .values({ id: "i3", title: "urgent task", status: "open", priority: 9, createdAt: 300 });
    await handle
      .insert(items)
      .values({ id: "i4", title: "alpha follow-up", status: "open", priority: 3, createdAt: 400 });
    await handle
      .insert(items)
      .values({ id: "i5", title: "zzz archive", status: "done", priority: 2, createdAt: 500 });
  }, 15_000);

  afterAll(async () => {
    await conn.close();
  });

  test("filter+order+limit URL — same rows and total through both paths", async () => {
    const input = { status: "eq.open", order: "priority.desc", limit: "2", offset: "0" };
    const resourcePage = offsetR.page(input) as unknown as Record<string, unknown>;
    const standalone = parseListQuery(input, offsetScope);
    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;

    const rowsA = await handle.page(items, resourcePage);
    const rowsB = await handle.page(items, standalone.page);
    const totalA = await handle.count(items, resourcePage.where);
    const totalB = await handle.count(items, standalone.page.where);
    expect(rowsB).toEqual(rowsA);
    expect(totalB).toBe(totalA);
    expect(rowsA.map((r) => r.id)).toEqual(["i3", "i4"]);
    expect(totalA).toBe(3);
  });

  test("search URL — same rows through both paths", async () => {
    const input = { search: "alpha", order: "createdAt.asc" };
    const resourcePage = offsetR.page(input) as unknown as Record<string, unknown>;
    const standalone = parseListQuery(input, offsetScope);
    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;
    const rowsA = await handle.page(items, resourcePage);
    const rowsB = await handle.page(items, standalone.page);
    expect(rowsB).toEqual(rowsA);
    expect(rowsA.map((r) => r.id)).toEqual(["i1", "i4"]);
  });
});
