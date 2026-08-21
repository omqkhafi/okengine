import { on, flow, http, fail } from "okengine";

import { db, files, notesMutate } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteAttachIn, NoteAttachOut, NotFound } from "../shapes";

/** Store a text attachment next to a note (`files:uploads`). */
export const attach = on(
  http.post().gate(notesMutate),
  flow({
    in: NoteAttachIn,
    out: NoteAttachOut,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(notes, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const key = `notes/${input.id}/attachment.txt`;
      await fx.store(files).put(key, input.text);
      return { key, bytes: new TextEncoder().encode(input.text).byteLength };
    },
  }),
);
