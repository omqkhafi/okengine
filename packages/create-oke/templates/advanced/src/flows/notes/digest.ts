import { on, flow, clock } from "okengine/http";
import { isNull } from "drizzle-orm";

import { db } from "@/core";
import { notes } from "@/db/schema.decl";
import { toIsoInstant } from "./shapes";

export const digestClock = clock.every("notes.digest", "1d");

/** Daily count of active notes (frozen under test drivers). */
export const digest = on(
  digestClock,
  flow("notes.digest", {
    do: async (_input, fx) => {
      const rows = await fx.store(db).select().from(notes).where(isNull(notes.archivedAt));
      return { active: rows.length, at: toIsoInstant(new Date(fx.clock.now())) };
    },
  }),
);
