/**
 * Shared lookups for the links unit.
 *
 * `_` prefix is skipped by `oke build` — this is not a route.
 * SELECT on `links` is open (public 302); owner checks live here.
 */

import type { Fx } from "okengine";
import { fail, type FlowFailure } from "okengine/http";
import { okid } from "okengine/okid";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db, redirects } from "@/core";
import { links } from "@/db/schema";
import { RESERVED_CODES } from "./shapes";

/** `{ code }` failure — NotFound / Forbidden / Conflict. */
export type LinkCodeFailure = FlowFailure<{ readonly code: string }>;

/** Cached redirect payload in `store.kv("redirects")`. */
export type RedirectCache = {
  readonly url: string;
  readonly expiresAt: string | null;
};

/** One `links` row as store helpers return it. */
export type LinkRow = {
  readonly id: string;
  readonly userId: string;
  readonly code: string;
  readonly url: string;
  readonly clicks: number;
  readonly expiresAt: Date | string | null;
  readonly archivedAt: Date | string | null;
  readonly createdAt: Date | string;
};

/**
 * Whether `raw` is a reserved path segment (`health`, `links`, `auth`).
 *
 * @param raw - Candidate short code
 */
export function isReservedCode(raw: string): boolean {
  return (RESERVED_CODES as readonly string[]).includes(raw.toLowerCase());
}

/**
 * Whether `raw` is an http(s) URL the redirector will follow.
 *
 * @param raw - Candidate destination
 */
export function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Public short URL from `PUBLIC_API_URL` cleartext and a short code.
 *
 * @param origin - Revealed `PUBLIC_API_URL` (trailing slash ignored)
 * @param code - Short code
 */
export function publicShortUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/${code}`;
}

/** Map a store temporal (`Date` / ISO / epoch-ms) to an ISO wire string. */
export function toIsoInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date(Number(value)).toISOString();
}

/**
 * UTC calendar day (`YYYY-MM-DD`) for `fx.clock.now()`.
 *
 * @param now - Epoch ms from `fx.clock.now()`
 */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Whether the destination is past `expiresAt` at `now`.
 *
 * @param expiresAt - Stored expiry (ISO / Date / epoch-ms) or `null`
 * @param now - Epoch ms from `fx.clock.now()`
 */
export function isExpired(expiresAt: unknown, now: number): boolean {
  if (expiresAt == null) return false;
  return new Date(toIsoInstant(expiresAt)).getTime() <= now;
}

/** Narrow a KV payload to {@link RedirectCache}. */
export function asRedirectCache(value: unknown): RedirectCache | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { readonly url?: unknown; readonly expiresAt?: unknown };
  if (typeof row.url !== "string") return null;
  return {
    url: row.url,
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
  };
}

/**
 * Load a link by code and require the caller to own it.
 *
 * SELECT RLS is open so public `GET /:code` works. Owner checks for get /
 * archive / report live in Flow `do` via this helper.
 *
 * @param fx - Flow effects
 * @param code - Short code from the path
 */
export async function loadOwnedLink(
  fx: Fx,
  code: string,
): Promise<LinkRow | LinkCodeFailure> {
  const [row] = await fx.store(db).select().from(links).where(eq(links.code, code));
  if (!row) return fail.notFound({ code });
  if (String(row.userId) !== fx.auth.userId) return fail.forbidden({ code });
  return row as LinkRow;
}

/**
 * Custom alias if the caller sent one; otherwise mint an 8-char `okid`
 * (no look-alikes / symbols). Four mint attempts; `"retry"` if all collide.
 *
 * Reserved path segments (`health` / `links` / `auth`) and unique-index
 * hits are `Conflict`.
 *
 * @param fx - Flow effects (SQL uniqueness check)
 * @param requested - Optional `code` from the create body
 */
export async function resolveShortCode(
  fx: Fx,
  requested: string | undefined,
): Promise<string | LinkCodeFailure> {
  const code = requested?.trim() ?? "";
  if (code) {
    if (isReservedCode(code)) return fail.conflict({ code });
    const existing = await fx.store(db).select().from(links).where(eq(links.code, code));
    if (existing[0]) return fail.conflict({ code });
    return code;
  }
  for (let i = 0; i < 4; i++) {
    const candidate = okid({ length: 8, lookAlikes: false, symbols: false });
    if (isReservedCode(candidate)) continue;
    const existing = await fx.store(db).select().from(links).where(eq(links.code, candidate));
    if (!existing[0]) return candidate;
  }
  return fail.conflict({ code: "retry" });
}

/**
 * Public 302 — raw `Response` is the envelope exception for `Location`.
 *
 * @param url - Destination the redirector will follow
 */
export function redirectTo(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

/**
 * Warm `store.kv("redirects")` so `GET /:code` can 302 without SQL.
 *
 * @param fx - Flow effects
 * @param code - Short code
 * @param url - Destination
 * @param expiresAt - Stored expiry (`Date` / ISO / epoch-ms) or `null`
 */
export async function warmRedirectCache(
  fx: Fx,
  code: string,
  url: string,
  expiresAt: unknown,
): Promise<void> {
  await fx.store(redirects).set(
    code,
    { url, expiresAt: expiresAt == null ? null : toIsoInstant(expiresAt) },
    "24h",
  );
}

/**
 * SQL fallback when KV is cold — live row, then warm the cache.
 *
 * Archived or past `expiresAt` is `NotFound`. Does not fall back further.
 *
 * @param fx - Flow effects
 * @param code - Path `:code`
 */
export async function loadLiveUrl(fx: Fx, code: string): Promise<string | LinkCodeFailure> {
  const now = fx.clock.now();
  const [row] = await fx
    .store(db)
    .select({ url: links.url, expiresAt: links.expiresAt })
    .from(links)
    .where(
      and(
        eq(links.code, code),
        isNull(links.archivedAt),
        or(isNull(links.expiresAt), gt(links.expiresAt, now)),
      ),
    );
  if (!row) return fail.notFound({ code });
  const url = String(row.url);
  await warmRedirectCache(fx, code, url, row.expiresAt);
  return url;
}
