/**
 * HTTP contracts for the links unit.
 *
 * Wire-honest Zod: ISO-8601 timestamps, not drizzle-zod `Date` columns.
 * Store insert/update coerces ISO / epoch-ms onto `timestamp` binds.
 */
import { z } from "zod";

/** Instant on the HTTP wire — ISO-8601 UTC. */
export const IsoInstant = z.iso.datetime();

/** Custom aliases that collide with static routes (`GET /:code` is last). */
export const RESERVED_CODES = ["health", "links", "auth"] as const;

/** Create body — destination, optional alias, optional expiry. */
export const LinkCreateIn = z.object({
  url: z.string().min(8).max(2048),
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  expiresAt: IsoInstant.optional(),
});

/** One link row on the wire — ISO timestamps. */
export const LinkOut = z.object({
  id: z.string(),
  userId: z.string(),
  code: z.string(),
  url: z.string(),
  clicks: z.number(),
  expiresAt: IsoInstant.nullable(),
  archivedAt: IsoInstant.nullable(),
  createdAt: IsoInstant,
});

/** List `data` is the item array. Pagination lives in HTTP `meta`. */
export const LinkListOut = z.array(LinkOut);

/** Path / query `{ code }` for get, archive, report, and public redirect. */
export const LinkCodeIn = z.object({
  code: z.string().min(1),
});

/** Missing code — get / archive / report / public redirect. */
export const NotFound = z.object({
  code: z.string(),
});

/** Caller does not own the row. */
export const Forbidden = z.object({
  code: z.string(),
});

/** Alias taken or reserved (`health` / `links` / `auth`). */
export const Conflict = z.object({
  code: z.string(),
});

/** Destination is not http(s). */
export const InvalidUrl = z.object({
  url: z.string(),
});

/** One UTC day in the Reach report. */
export const DailyOut = z.object({
  day: z.string(),
  clicks: z.number(),
});

/** Owner report — link totals plus per-day rows. */
export const LinkReportOut = z.object({
  code: z.string(),
  clicks: z.number(),
  days: z.array(DailyOut),
});

/** Wire DTO for one link row. */
export type LinkOut = z.infer<typeof LinkOut>;
