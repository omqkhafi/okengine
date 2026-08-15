/**
 * In-memory list page — search, filter, sort, and page rows.
 *
 * Authors call this through {@link FxJson.withQuery}. Extra input keys
 * auto-eq when they exist on the row. Path `id` is never auto-eq.
 */

import {
  collectFilters,
  compareValues,
  LIST_RESERVED,
  matchNode,
  parseOrder,
  parseSelect,
  projectSelect,
  sortByOrder,
  type ColumnScope,
  type OrderTerm,
} from "./list-query.ts";

/** Pagination mode for a list. */
export type PageMode = "offset" | "cursor";

/** Next / previous list request — pass to the same list call. */
export type PagerLink = {
  readonly cursor: string;
};

/** Shared knobs every page meta carries. */
export type PageMetaBase = {
  readonly mode: PageMode;
  readonly limit: number;
  readonly next: PagerLink | null;
  readonly prev: PagerLink | null;
};

/** Offset-mode meta — `total` is exact (in-memory). */
export type OffsetMeta = PageMetaBase & {
  readonly mode: "offset";
  readonly total: number;
  readonly offset: number;
};

/** Cursor-mode meta — keyset; no `total`. */
export type CursorMeta = PageMetaBase & {
  readonly mode: "cursor";
};

/** Discriminated page meta. */
export type PageMeta = OffsetMeta | CursorMeta;

/**
 * `listPage` result — feed to `fx.json.with(page)`.
 *
 * @typeParam T - Item type
 * @typeParam M - Meta variant
 */
export type Page<T, M extends PageMeta = PageMeta> = {
  readonly data: T[];
  readonly meta: M;
};

/** Offset page. */
export type OffsetPage<T> = Page<T, OffsetMeta>;

/** Cursor page. */
export type CursorPage<T> = Page<T, CursorMeta>;

/** Loose list query — PostgREST column keys pass through. */
export type ListQuery = {
  readonly q?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: string;
  readonly order?: string;
  readonly orderBy?: string;
  readonly select?: string;
  readonly or?: string;
  readonly and?: string;
  readonly [key: string]: unknown;
};

/**
 * Optional third argument to {@link listPage} / `fx.json.withQuery`.
 *
 * @typeParam T - Item type
 */
export type QueryPageSpec<T> = {
  /** Pagination; default `"offset"`. */
  readonly mode?: PageMode;
  /** Keyset fields (required when `mode: "cursor"`). */
  readonly cursor?: readonly (keyof T & string)[];
  /** `q` / `search` substring fields, or a predicate. Default: all strings. */
  readonly search?: readonly (keyof T & string)[] | ((item: T, q: string) => boolean);
  /** `?col=op.value` whitelist. Default `"all"`. */
  readonly filter?: ColumnScope<T>;
  /** `?order=` whitelist. Default `"all"`. */
  readonly order?: ColumnScope<T>;
  /** `?select=` whitelist. Default `"all"`. */
  readonly select?: ColumnScope<T>;
  /** Extra ListIn keys → keep when the input value is set (unadvertised). */
  readonly filters?: Readonly<Record<string, (item: T, value: unknown) => boolean>>;
  /** Default page size (default 25). */
  readonly limit?: number;
  /** `limit` cap (default 100). */
  readonly maxLimit?: number;
};

const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_LIMIT = 100;

const ERR = "fx.json.withQuery";

/**
 * Search, filter, sort, and page an in-memory list.
 *
 * Zero-config: `q` searches every string field; extra keys auto-eq except
 * `id`; PostgREST filter / order / select are open.
 *
 * @param items - Already-mapped rows
 * @param input - List query (validated or loose)
 * @param spec - Mode + search / order / cursor fields
 */
export function listPage<T>(
  items: readonly T[],
  input: unknown,
  spec: QueryPageSpec<T> = {},
): Page<T> {
  const mode = spec.mode ?? "offset";
  if (mode === "cursor" && (spec.cursor === undefined || spec.cursor.length === 0)) {
    throw new TypeError(`${ERR}: mode "cursor" requires spec.cursor fields`);
  }
  const bag = asBag(input);
  if (mode === "cursor" && bag.offset !== undefined) {
    throw new TypeError(`${ERR}: offset is not valid in cursor mode`);
  }

  const maxLimit = spec.maxLimit ?? DEFAULT_MAX_LIMIT;
  const defaultLimit = spec.limit ?? DEFAULT_LIMIT;
  const limit = clampLimit(asNumber(bag.limit) ?? defaultLimit, maxLimit);

  let rows = [...items];
  rows = applyExtraFilters(rows, bag, spec.filters);
  rows = applyAutoEq(rows, bag);
  rows = applySearch(rows, str(bag, "search") ?? str(bag, "q"), spec.search);
  rows = applyPostgrestFilters(rows, bag, spec.filter ?? "all");
  const terms = resolveOrderTerms(bag, spec.order ?? "all", spec.cursor);
  rows = sortByOrder(rows, terms);

  const descending = terms[0]?.dir === "desc";
  let page: Page<T>;
  if (mode === "cursor") {
    page = pageCursor(rows, str(bag, "cursor"), spec.cursor!, limit, descending);
  } else {
    page = pageOffset(rows, resolveOffset(bag), limit);
  }
  const projected = applySelect(page.data, str(bag, "select"), spec.select ?? "all");
  return { data: projected, meta: page.meta };
}

function asBag(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object") return input as Record<string, unknown>;
  return {};
}

function str(bag: Record<string, unknown>, key: string): string | undefined {
  const v = bag[key];
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clampLimit(limit: number, maxLimit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, maxLimit);
}

function applyExtraFilters<T>(
  items: readonly T[],
  bag: Record<string, unknown>,
  filters: QueryPageSpec<T>["filters"],
): T[] {
  if (filters === undefined) return [...items];
  return items.filter((item) => {
    for (const [key, keep] of Object.entries(filters)) {
      const value = bag[key];
      if (value === undefined) continue;
      if (!keep(item, value)) return false;
    }
    return true;
  });
}

/**
 * Plain extra keys (`teamKey=eng`) keep rows where `row[key] === value`.
 * Never auto-eq `id` (nested path parent). PostgREST `op.value` is not eq.
 */
function applyAutoEq<T>(items: readonly T[], bag: Record<string, unknown>): T[] {
  const eqs: { readonly key: string; readonly value: unknown }[] = [];
  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined) continue;
    if (key === "id" || LIST_RESERVED.has(key)) continue;
    if (typeof value === "string" && value.includes(".")) continue;
    eqs.push({ key, value });
  }
  if (eqs.length === 0) return [...items];
  return items.filter((item) => {
    if (item === null || typeof item !== "object") return true;
    const row = item as Record<string, unknown>;
    for (const { key, value } of eqs) {
      if (!(key in row)) continue;
      if (row[key] !== value) return false;
    }
    return true;
  });
}

function applyPostgrestFilters<T>(
  items: readonly T[],
  bag: Record<string, unknown>,
  filter: ColumnScope<T> | undefined,
): T[] {
  const nodes = collectFilters(bag, filter);
  if ("error" in nodes) throw new TypeError(`${ERR}: ${nodes.error}`);
  if (nodes.length === 0) return [...items];
  return items.filter((item) =>
    nodes.every((node) => matchNode(item as Record<string, unknown>, node)),
  );
}

function resolveOrderTerms<T>(
  bag: Record<string, unknown>,
  scope: ColumnScope<T> | undefined,
  cursorKeys: QueryPageSpec<T>["cursor"],
): OrderTerm[] {
  const raw = str(bag, "order");
  const orderBy = str(bag, "orderBy");
  let terms: OrderTerm[] = [];
  if (raw !== undefined && raw !== "asc" && raw !== "desc") {
    const parsed = parseOrder(raw);
    if ("error" in parsed) throw new TypeError(`${ERR}: ${parsed.error}`);
    terms = parsed;
  } else if (orderBy !== undefined) {
    const dir = raw === "desc" ? "desc" : "asc";
    terms = [{ key: orderBy, dir }];
  }
  const kept = terms.filter((t) => {
    if (scope === "none") return false;
    if (scope === undefined || scope === "all") return true;
    return scope.includes(t.key as keyof T & string);
  });
  if (cursorKeys) {
    for (const key of cursorKeys) {
      if (!kept.some((t) => t.key === key)) kept.push({ key, dir: "asc" });
    }
  }
  return kept;
}

function applySelect<T>(
  items: readonly T[],
  raw: string | undefined,
  scope: ColumnScope<T> | undefined,
): T[] {
  if (raw === undefined) return [...items];
  if (scope === "none") throw new TypeError(`${ERR}: select is not enabled`);
  const parsed = parseSelect(raw);
  if ("error" in parsed) throw new TypeError(`${ERR}: ${parsed.error}`);
  for (const term of parsed) {
    if (scope !== undefined && scope !== "all" && !scope.includes(term.key as keyof T & string)) {
      throw new TypeError(`${ERR}: unknown column "${term.key}"`);
    }
  }
  return projectSelect(items, parsed);
}

function applySearch<T>(
  items: readonly T[],
  q: string | undefined,
  search: QueryPageSpec<T>["search"],
): T[] {
  if (q === undefined || q.length === 0) return [...items];
  const needle = q.toLowerCase();
  if (typeof search === "function") {
    return items.filter((item) => search(item, needle));
  }
  if (search !== undefined) {
    return items.filter((item) =>
      search.some((key) =>
        String(item[key] ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    );
  }
  return items.filter((item) => searchAllStrings(item, needle));
}

function searchAllStrings(item: unknown, needle: string): boolean {
  if (item === null || typeof item !== "object") {
    return String(item).toLowerCase().includes(needle);
  }
  for (const value of Object.values(item as Record<string, unknown>)) {
    if (typeof value === "string" && value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function compare(a: unknown, b: unknown): number {
  return compareValues(a, b);
}

function resolveOffset(bag: Record<string, unknown>): number {
  const raw = str(bag, "cursor");
  if (raw !== undefined) {
    const offset = decodeOffsetCursor(raw);
    if (offset === null) throw new TypeError(`${ERR}: invalid cursor`);
    return offset;
  }
  return asNumber(bag.offset) ?? 0;
}

function pageOffset<T>(items: readonly T[], offset: number, limit: number): OffsetPage<T> {
  const start = offset < 0 ? 0 : offset;
  const data = items.slice(start, start + limit);
  const hasNext = start + data.length < items.length;
  const hasPrevious = start > 0;
  return {
    data,
    meta: {
      mode: "offset",
      total: items.length,
      limit,
      offset: start,
      next: hasNext ? { cursor: encodeOffsetCursor(start + limit) } : null,
      prev: hasPrevious ? { cursor: encodeOffsetCursor(Math.max(0, start - limit)) } : null,
    },
  };
}

function pageCursor<T>(
  items: readonly T[],
  rawCursor: string | undefined,
  keys: readonly (keyof T & string)[],
  limit: number,
  descending: boolean,
): CursorPage<T> {
  const decoded = rawCursor === undefined ? undefined : decodeCursor(rawCursor, keys.length);
  if (rawCursor !== undefined && decoded === null) {
    throw new TypeError(`${ERR}: invalid cursor`);
  }
  const dir = decoded?.dir ?? "after";
  const values = decoded?.values;

  if (dir === "before" && values !== undefined) {
    const before = items.filter((item) => isBefore(item, keys, values, descending));
    const hasPrevious = before.length > limit;
    const data = hasPrevious ? before.slice(-limit) : before;
    const first = data[0];
    const last = data[data.length - 1];
    const hasNext = items.some((item) => !isBefore(item, keys, values, descending));
    return {
      data,
      meta: {
        mode: "cursor",
        limit,
        next:
          hasNext && last != null
            ? {
                cursor: encodeCursor(
                  keys.map((key) => last[key]),
                  "after",
                ),
              }
            : null,
        prev:
          hasPrevious && first != null
            ? {
                cursor: encodeCursor(
                  keys.map((key) => first[key]),
                  "before",
                ),
              }
            : null,
      },
    };
  }

  let after: T[] = [...items];
  if (values !== undefined) {
    after = items.filter((item) => isAfter(item, keys, values, descending));
  }
  const hasNext = after.length > limit;
  const data = hasNext ? after.slice(0, limit) : after;
  const first = data[0];
  const last = data[data.length - 1];
  const hasPrevious =
    values !== undefined && items.some((item) => !isAfter(item, keys, values, descending));
  return {
    data,
    meta: {
      mode: "cursor",
      limit,
      next:
        hasNext && last != null
          ? {
              cursor: encodeCursor(
                keys.map((key) => last[key]),
                "after",
              ),
            }
          : null,
      prev:
        hasPrevious && first != null
          ? {
              cursor: encodeCursor(
                keys.map((key) => first[key]),
                "before",
              ),
            }
          : null,
    },
  };
}

function isAfter<T>(
  item: T,
  keys: readonly (keyof T & string)[],
  values: readonly unknown[],
  descending: boolean,
): boolean {
  for (let i = 0; i < keys.length; i++) {
    const cmp = compare(item[keys[i]!], values[i]);
    if (cmp === 0) continue;
    return descending ? cmp < 0 : cmp > 0;
  }
  return false;
}

function isBefore<T>(
  item: T,
  keys: readonly (keyof T & string)[],
  values: readonly unknown[],
  descending: boolean,
): boolean {
  return isAfter(item, keys, values, !descending);
}

/** Keyset token direction — `?cursor=` carries either side. */
type CursorDir = "after" | "before";

function encodeOffsetCursor(offset: number): string {
  return btoa(JSON.stringify({ k: "off", o: offset }));
}

function decodeOffsetCursor(raw: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (
      value !== null &&
      typeof value === "object" &&
      "k" in value &&
      value.k === "off" &&
      "o" in value &&
      typeof value.o === "number" &&
      Number.isInteger(value.o) &&
      value.o >= 0
    ) {
      return value.o;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(values: readonly unknown[], dir: CursorDir): string {
  return btoa(JSON.stringify({ v: values, d: dir }));
}

function decodeCursor(
  raw: string,
  arity: number,
): { readonly values: readonly unknown[]; readonly dir: CursorDir } | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (Array.isArray(value) && value.length === arity) {
      return { values: value, dir: "after" };
    }
    if (
      value !== null &&
      typeof value === "object" &&
      "v" in value &&
      "d" in value &&
      Array.isArray(value.v) &&
      value.v.length === arity &&
      (value.d === "after" || value.d === "before")
    ) {
      return { values: value.v, dir: value.d };
    }
    return null;
  } catch {
    return null;
  }
}
