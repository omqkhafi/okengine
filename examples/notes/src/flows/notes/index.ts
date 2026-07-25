import { on, flow, http } from "okengine";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { db } from "../../core";
import { notes } from "../../schema";

// Contracts derived from the schema — one source of truth, refined where the API is stricter
const NewNote  = createInsertSchema(notes, { title: (s) => s.min(1).max(120) })
                   .omit({ id: true, createdAt: true });
const Note     = createSelectSchema(notes);
const NoteId   = z.object({ id: z.string() });
const NotFound = z.object({});

export const create = on(http.post("/notes"), flow({
  in: NewNote,
  out: NoteId,
  do: async (input, fx) => {
    const [note] = await fx.store(db).insert(notes).values(input).returning();
    return { id: note.id };
  },
}));
// effects → writes[sql:notes]

export const list = on(http.get("/notes"), flow({
  out: Note.array(),
  do: (_, fx) => fx.store(db).select().from(notes),
}));
// effects → reads[sql:notes]

export const get = on(http.get("/notes/:id"), flow({
  in: NoteId,
  out: Note,
  errors: { NotFound },
  do: async ({ id }, fx) => (await fx.store(db).findById(notes, id)) ?? fx.fail("NotFound", {}),
}));

export const remove = on(http.delete("/notes/:id"), flow({
  in: NoteId,
  errors: { NotFound },
  do: async ({ id }, fx) => {
    const deleted = await fx.store(db).delete(notes, id);
    if (!deleted) return fx.fail("NotFound", {});
  },
}));
