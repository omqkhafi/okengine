import { on, flow, clock } from "okengine/http";
import { isNull } from "drizzle-orm";

import { db } from "@/core";
import { notes } from "@/db/schema.decl";
import { NoteDigestOut } from "./shapes";

export const digestClock = clock("notes.digest", { every: "1d" });

/** Daily count of active notes (frozen under test drivers). */
export const digest = on(
  digestClock,
  flow({
    out: NoteDigestOut,
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      return { active: rows.length, at: fx.clock.now() };
    },
  }),
);
