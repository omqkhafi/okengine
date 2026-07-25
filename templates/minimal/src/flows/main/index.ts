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

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/"),
  flow({
    out: z.object({
      ok: z.literal(true),
      console: z.string(),
      try: z.string(),
    }),
    do: () => ({
      ok: true as const,
      console: "http://127.0.0.1:6533",
      try: "GET /entries",
    }),
  }),
);

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
