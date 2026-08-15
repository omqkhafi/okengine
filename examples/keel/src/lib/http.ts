/**
 * Keel list input helpers. Paging is `fx.json.withQuery` — `out` is the
 * item array; pagination sits on HTTP `meta`.
 */

import { fail } from "okengine";
import { z, type ZodType } from "zod";

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

const DEFAULT_MAX_LIMIT = 100;

/** Shared meta fields. */
const PagerLinkSchema = z.object({ cursor: z.string() });

export const PageMetaBase = z.object({
  mode: z.enum(["offset", "cursor"]),
  limit: z.number().int().min(1),
  next: PagerLinkSchema.nullable(),
  prev: PagerLinkSchema.nullable(),
});

/** Offset meta — extends {@link PageMetaBase}. */
export const OffsetMeta = PageMetaBase.extend({
  mode: z.literal("offset"),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
});

/** Cursor meta — extends {@link PageMetaBase}. */
export const CursorMeta = PageMetaBase.extend({
  mode: z.literal("cursor"),
});

/** Shared list query (no pagination field). Column filters pass through. */
export const ListInBase = z
  .object({
    q: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(DEFAULT_MAX_LIMIT).optional(),
    order: z.string().optional(),
    orderBy: z.string().optional(),
    select: z.string().optional(),
    or: z.string().optional(),
    and: z.string().optional(),
  })
  .passthrough();

/** Offset list query — extends {@link ListInBase}. `cursor` is the pager token. */
export const OffsetListIn = ListInBase.extend({
  offset: z.number().int().min(0).optional(),
  cursor: z.string().optional(),
});

/** Cursor list query — extends {@link ListInBase}. */
export const CursorListIn = ListInBase.extend({
  cursor: z.string().optional(),
});

/**
 * Flow `out` for a list — the `data` array. Pagination lives in HTTP `meta`.
 *
 * @param item - Element schema
 */
export function pageOut<T extends ZodType>(item: T) {
  return z.array(item);
}

/** Offset `listIn` options. */
export type OffsetListOpts = {
  readonly mode?: "offset";
  readonly maxLimit?: number;
};

/** Cursor `listIn` options. */
export type CursorListOpts = {
  readonly mode: "cursor";
  readonly maxLimit?: number;
};

/**
 * List input for one mode. Extra Zod fields (path `id`, `teamKey`, …) merge in.
 *
 * @param opts - Pagination mode and optional `maxLimit`
 * @param extra - Additional query / path fields
 */
export function listIn(opts?: OffsetListOpts): typeof OffsetListIn;
export function listIn(opts: CursorListOpts): typeof CursorListIn;
export function listIn<Extra extends z.ZodRawShape>(
  opts: OffsetListOpts | undefined,
  extra: Extra,
): z.ZodObject<typeof OffsetListIn.shape & Extra>;
export function listIn<Extra extends z.ZodRawShape>(
  opts: CursorListOpts,
  extra: Extra,
): z.ZodObject<typeof CursorListIn.shape & Extra>;
export function listIn(
  opts?: { readonly mode?: PageMode; readonly maxLimit?: number },
  extra?: z.ZodRawShape,
): z.ZodType;
export function listIn(
  opts?: { readonly mode?: PageMode; readonly maxLimit?: number },
  extra?: z.ZodRawShape,
): z.ZodType {
  const mode = opts?.mode ?? "offset";
  const maxLimit = opts?.maxLimit ?? DEFAULT_MAX_LIMIT;
  const base = ListInBase.extend({
    limit: z.number().int().min(1).max(maxLimit).optional(),
  });
  const paged =
    mode === "cursor"
      ? base.extend({ cursor: z.string().optional() })
      : base.extend({
          offset: z.number().int().min(0).optional(),
          cursor: z.string().optional(),
        });
  const merged = extra !== undefined && Object.keys(extra).length > 0 ? paged.extend(extra) : paged;
  return merged.passthrough();
}

/**
 * Typed `NotFound` — `fail()` does not throw.
 *
 * @param id - Missing row id
 */
export function notFound(id: string) {
  return fail("NotFound", { id });
}

/**
 * Parse a store row through a select schema.
 *
 * @param schema - Item schema
 * @param row - Raw row
 */
export function parseRow<T extends ZodType>(schema: T, row: unknown): z.infer<T> {
  return schema.parse(row);
}

/** Optional third argument to {@link queryPage}. */
export type QueryPageSpec = {
  readonly mode?: PageMode;
  readonly search?: readonly string[];
  readonly filter?: "all" | "none";
  readonly order?: "all" | "none";
  readonly select?: "all" | "none";
  readonly maxLimit?: number;
};

/**
 * In-memory list page for handwritten lists (inbox, my tasks, board).
 * Resource CRUD uses `store.resource` / `fx.json.withQuery` instead.
 *
 * @param items - Already-mapped rows
 * @param input - List query
 * @param spec - Search fields and page size
 */
export function queryPage<T extends Record<string, unknown>>(
  items: readonly T[],
  input: unknown,
  spec: QueryPageSpec = {},
): { data: T[]; meta: OffsetMeta } {
  const bag = (input ?? {}) as Record<string, unknown>;
  const maxLimit = spec.maxLimit ?? DEFAULT_MAX_LIMIT;
  const limitRaw = typeof bag.limit === "number" ? bag.limit : 25;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), maxLimit);
  const offsetRaw = typeof bag.offset === "number" ? bag.offset : 0;
  const offset = Math.max(Math.trunc(offsetRaw), 0);
  const q =
    (typeof bag.q === "string" ? bag.q : typeof bag.search === "string" ? bag.search : "").trim();
  let rows = [...items];
  if (q.length > 0) {
    const needle = q.toLowerCase();
    const fields = spec.search;
    rows = rows.filter((row) => {
      const keys = fields ?? Object.keys(row);
      return keys.some((key) => String(row[key] ?? "").toLowerCase().includes(needle));
    });
  }
  const total = rows.length;
  const data = rows.slice(offset, offset + limit);
  const nextOff = offset + limit;
  return {
    data,
    meta: {
      mode: "offset",
      total,
      limit,
      offset,
      next: nextOff < total ? { cursor: String(nextOff) } : null,
      prev: offset > 0 ? { cursor: String(Math.max(0, offset - limit)) } : null,
    },
  };
}
