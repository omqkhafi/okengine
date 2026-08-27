import { on, flow, http } from "okengine/http";

import { db, notesMutate, webhookSecret } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteCreateIn, NoteOut } from "./shapes";
import { noteCreated } from "./signals";

/** Create a note, emit `note-created`, touch vault. */
export const create = on(
  http.post().gate(notesMutate),
  flow({
    in: NoteCreateIn,
    out: NoteOut,
    do: async (input, fx) => {
      await fx.vault.get(webhookSecret);
      const id = fx.id();
      const createdAt = fx.clock.now();
      await fx.store(db).insert(notes).values({
        id,
        title: input.title,
        body: input.body,
        archivedAt: null,
        createdAt,
      });
      await fx.emit(noteCreated, { id, title: input.title }, { key: id });
      return {
        id,
        title: input.title,
        body: input.body,
        archivedAt: null,
        createdAt,
      };
    },
  }),
);
