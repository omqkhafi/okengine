import { on, flow, http, fail } from "okengine/http";

import { db } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteIdIn, NoteOut, NotFound } from "../shapes";

/** Fetch one note by id. */
export const get = on(
  http.get().public(),
  flow({
    in: NoteIdIn,
    out: NoteOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      return {
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
        createdAt: Number(row.createdAt),
      };
    },
  }),
);
