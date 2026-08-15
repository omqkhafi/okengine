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

export const NoteAttachIn = z.object({
  id: z.string().min(1),
  /** UTF-8 text body stored under `notes/{id}/attachment.txt`. */
  text: z.string().min(1).max(100_000),
});

export const NoteAttachOut = z.object({
  key: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const NoteDigestOut = z.object({
  active: z.number().int().nonnegative(),
  at: z.number(),
});

export const NoteSummarizeIn = z.object({
  id: z.string().min(1),
});

export const NoteSummarizeOut = z.object({
  id: z.string(),
  summary: z.string(),
  /** Logical model name that answered (`smart`, `local`, …). */
  via: z.string().min(1),
});

/** Both recovery links failed — no silent text excerpt. */
export const Unavailable = z.object({
  message: z.string(),
});
