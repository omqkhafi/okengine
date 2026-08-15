import { z } from "zod";

export const NoteCreateIn = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

export const NoteOut = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
});

/** List `data` is the item array. Pagination lives in HTTP `meta`. */
export const NoteListOut = z.array(NoteOut);

export const NoteIdIn = z.object({
  id: z.string().min(1),
});

export const NotFound = z.object({
  id: z.string(),
});
