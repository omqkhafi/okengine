import { z } from "zod";

/** Instant on the HTTP wire — ISO-8601 UTC. */
export const IsoInstant = z.iso.datetime();

export const NoteCreateIn = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

export const NoteOut = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  archivedAt: IsoInstant.nullable(),
  createdAt: IsoInstant,
});

/** List `data` is the item array. Pagination lives in HTTP `meta`. */
export const NoteListOut = z.array(NoteOut);

export const NoteIdIn = z.object({
  id: z.string().min(1),
});

export const NotFound = z.object({
  id: z.string(),
});

/** Map a store temporal (`Date` / ISO / epoch-ms) to an ISO wire string. */
export function toIsoInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date(Number(value)).toISOString();
}
