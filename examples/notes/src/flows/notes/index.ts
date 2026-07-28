import { on, flow, http } from "okengine";
import { and, desc, eq, like, lt, or } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { db } from "../../core";
import { notes } from "../../schema";

// Contracts derived from the schema — one source of truth, refined where the API is stricter
const NewNote = createInsertSchema(notes, { title: (s) => s.min(1).max(120) }).omit({
  id: true,
  createdAt: true,
});
const Note = createSelectSchema(notes);
const NoteId = z.object({ id: z.string() });
const PatchNote = NoteId.extend(NewNote.partial().shape);
const ListNotes = z.object({
  cursor: z
    .string()
    .refine((s) => decodeCursor(s) !== null, { message: "invalid cursor" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().min(1).max(120).optional(),
});
const NotePage = z.object({ data: Note.array(), nextCursor: z.string().nullable() });
// Proposal (not implemented): one shared kernel NotFound failure schema +
// statusForFailure("NotFound") → 404 in src/compiler/response.ts, so apps stop
// redeclaring this empty shape. Until that lands the live encoder answers 400
// for NotFound — the mocked 404 in src/client/notes-contract.test.ts is
// isolated-stub fiction, not runtime behavior.
const NotFound = z.object({});

const DEFAULT_PAGE_SIZE = 20;

/** Keyset cursor — opaque base64 of `{ createdAt, id }` (last row of a page). */
interface NoteCursor {
  readonly createdAt: number;
  readonly id: string;
}

function encodeCursor(cursor: NoteCursor): string {
  return btoa(JSON.stringify(cursor));
}

function decodeCursor(raw: string): NoteCursor | null {
  try {
    const value: unknown = JSON.parse(atob(raw));
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as NoteCursor).createdAt === "number" &&
      typeof (value as NoteCursor).id === "string"
    ) {
      return value as NoteCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export const create = on(
  http.post("/notes"),
  flow({
    in: NewNote,
    out: NoteId,
    do: async (input, fx) => {
      const [note] = await fx.store(db).insert(notes).values(input).returning();
      return { id: note.id };
    },
  }),
);
// effects → writes[sql:notes]

export const list = on(
  http.get("/notes"),
  flow({
    in: ListNotes,
    out: NotePage,
    do: async (input, fx) => {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
      const where = and(
        input.q === undefined ? undefined : like(notes.title, `%${input.q}%`),
        cursor === null
          ? undefined
          : or(
              lt(notes.createdAt, cursor.createdAt),
              and(eq(notes.createdAt, cursor.createdAt), lt(notes.id, cursor.id)),
            ),
      );

      const from = fx.store(db).select().from(notes);
      const filtered = where === undefined ? from : from.where(where);
      const rows = await filtered
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.length > 0 && rows.length > limit ? page[page.length - 1] : undefined;
      return {
        data: page,
        nextCursor:
          last === undefined
            ? null
            : encodeCursor({ createdAt: Number(last.createdAt), id: String(last.id) }),
      };
    },
  }),
);
// effects → reads[sql:notes]

export const get = on(
  http.get("/notes/:id"),
  flow({
    in: NoteId,
    out: Note,
    errors: { NotFound },
    do: async ({ id }, fx) => (await fx.store(db).findById(notes, id)) ?? fx.fail("NotFound", {}),
  }),
);

export const update = on(
  http.patch("/notes/:id"),
  flow({
    in: PatchNote,
    out: Note,
    errors: { NotFound },
    do: async ({ id, ...patch }, fx) => {
      const store = fx.store(db);
      const existing = await store.findById(notes, id);
      if (!existing) return fx.fail("NotFound", {});
      if (Object.keys(patch).length > 0) {
        await store.update(notes).set(patch).where(eq(notes.id, id));
      }
      return (await store.findById(notes, id)) ?? fx.fail("NotFound", {});
    },
  }),
);
// effects → reads[sql:notes], writes[sql:notes]

export const remove = on(
  http.delete("/notes/:id"),
  flow({
    in: NoteId,
    errors: { NotFound },
    do: async ({ id }, fx) => {
      const deleted = await fx.store(db).delete(notes, id);
      if (!deleted) return fx.fail("NotFound", {});
    },
  }),
);
