import { on, flow, http } from "okengine";
import { isNull } from "drizzle-orm";

import { db } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteListOut } from "./shapes";

/** List active (non-archived) notes, newest first. */
export const list = on(
  http.get().public(),
  flow({
    out: NoteListOut,
    do: async (input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      const data = [...rows]
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .map((r) => ({
          id: String(r.id),
          title: String(r.title),
          body: String(r.body),
          archivedAt: r.archivedAt == null ? null : Number(r.archivedAt),
          createdAt: Number(r.createdAt),
        }));
      return fx.json.withQuery(data, input);
    },
  }),
);
