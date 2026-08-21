import { on, flow, every } from "okengine";
import { isNull } from "drizzle-orm";

import { db } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteDigestOut } from "./shapes";

/** Daily count of active notes (frozen under test drivers). */
export const digest = on(
  every("1d"),
  flow({
    out: NoteDigestOut,
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      return { active: rows.length, at: fx.clock.now() };
    },
  }),
);
