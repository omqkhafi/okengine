/**
 * List pager — `page.next()` / `page.prev()` and `for await` of the call.
 *
 * `meta.next` / `meta.prev` are the next request (`{ cursor }`), not flags.
 * Methods always exist; a missing link returns an empty page (no request).
 * `for await` stops when `meta.next` is null — it does not yield the empty
 * terminal page. `page.next()` at the end still returns `[]`.
 */

import type { ClientEnvelope, ClientResult } from "./types.ts";

/** Next / previous list request — spread into the same list call. */
export type PagerLink = {
  readonly cursor: string;
};

/** Walk helpers attached to every {@link ClientResult}. */
export type ClientPager<
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Next page, or an empty success when `meta.next` is null. */
  readonly next: () => Promise<ClientResult<O, E>>;
  /** Previous page, or an empty success when `meta.prev` is null. */
  readonly prev: () => Promise<ClientResult<O, E>>;
};

type Invoke = (input?: unknown) => Promise<ClientResult>;

/**
 * True when `meta` carries list pager links.
 *
 * @param meta - Result meta
 */
export function isPagerMeta(
  meta: unknown,
): meta is { readonly next: PagerLink | null; readonly prev: PagerLink | null } {
  return meta !== null && typeof meta === "object" && "next" in meta && "prev" in meta;
}

/**
 * Read a pager link from meta.
 *
 * @param meta - Result meta
 * @param side - Direction
 */
export function pagerLink(meta: unknown, side: "next" | "prev"): PagerLink | null {
  if (!isPagerMeta(meta)) return null;
  const link = meta[side];
  if (link === null || typeof link !== "object") return null;
  return typeof link.cursor === "string" && link.cursor.length > 0 ? { cursor: link.cursor } : null;
}

/**
 * Attach always-callable `next` / `prev` and an async iterator from this page.
 *
 * @param result - Transport result
 * @param invoke - Same flow call
 * @param input - Last list input (filters, limit, …)
 */
export function attachPager(result: ClientEnvelope, invoke: Invoke, input: unknown): ClientResult {
  const walk = (side: "next" | "prev"): (() => Promise<ClientResult>) => {
    return async () => {
      if (result.error !== null) return attachPager(result, invoke, input);
      const link = pagerLink(result.meta, side);
      if (link === null) return attachPager(terminalPage(result, side), invoke, input);
      return invoke(mergeInput(input, link));
    };
  };
  const page = { ...result, next: walk("next"), prev: walk("prev") } as ClientResult;
  return Object.assign(page, {
    [Symbol.asyncIterator]: () => iterateFrom(page),
  });
}

/**
 * Yield this page, then `next()`, until `meta.next` is null.
 *
 * @param page - Starting page
 */
export async function* iterateFrom(page: ClientResult): AsyncGenerator<ClientResult, void, void> {
  yield page;
  while (page.error === null && pagerLink(page.meta, "next") !== null) {
    page = await page.next();
    yield page;
  }
}

/**
 * Yield each page until `meta.next` is null.
 *
 * @param invoke - List call
 * @param input - First-page input
 */
export async function* iteratePages(
  invoke: Invoke,
  input?: unknown,
): AsyncGenerator<ClientResult, void, void> {
  const page = await invoke(input);
  yield* iterateFrom(page);
}

/**
 * Thenable (one page) + async-iterable (walk) for `list()`.
 *
 * @param invoke - List call
 * @param input - First-page input
 */
export function asThenableIterable(
  invoke: Invoke,
  input?: unknown,
): Promise<ClientResult> & AsyncIterable<ClientResult> {
  const promise = invoke(input);
  return Object.assign(promise, {
    [Symbol.asyncIterator]: () => iteratePages(invoke, input),
  });
}

function mergeInput(input: unknown, link: PagerLink): unknown {
  const base = input !== null && typeof input === "object" ? input : {};
  return { ...base, ...link };
}

function terminalPage(
  result: Extract<ClientEnvelope, { readonly error: null }>,
  side: "next" | "prev",
): ClientEnvelope {
  const data = Array.isArray(result.data) ? [] : result.data;
  const meta =
    result.meta !== undefined && typeof result.meta === "object"
      ? {
          ...result.meta,
          next: side === "next" ? null : result.meta.next,
          prev: side === "prev" ? null : result.meta.prev,
        }
      : result.meta;
  return { data, error: null, meta };
}
