import { on, flow, http } from "okengine";
import { z } from "zod";
import { db } from "../../core";
import { entries } from "../../schema";

const NewEntry = z.object({ body: z.string().min(1) });
const EntryId = z.object({ id: z.string() });
const Entry = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.number(),
});

export const create = on(
  http.post("/entries"),
  flow({
    in: NewEntry,
    out: EntryId,
    do: async (input, fx) => {
      const [row] = await fx.store(db).insert(entries).values(input).returning();
      return { id: row.id };
    },
  }),
);

export const list = on(
  http.get("/entries"),
  flow({
    out: Entry.array(),
    do: (_, fx) => fx.store(db).select().from(entries),
  }),
);
