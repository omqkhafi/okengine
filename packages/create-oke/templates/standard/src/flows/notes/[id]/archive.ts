import { on, flow, http, fail } from "okengine/http";
import { eq } from "drizzle-orm";

import { db, notesMutate } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteIdIn, NoteOut, NotFound, toIsoInstant } from "../shapes";

/** Soft-archive a note. */
export const archive = on(
  http.post().gate(notesMutate),
  flow({
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const archivedAt = new Date(fx.clock.now());
      await fx.store(db).update(notes).set({ archivedAt }).where(eq(notes.id, input.id));
      return {
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        archivedAt: toIsoInstant(archivedAt),
        createdAt: toIsoInstant(row.createdAt),
      };
    },
  }),
);
