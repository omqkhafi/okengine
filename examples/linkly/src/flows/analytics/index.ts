import { on, flow, http } from "okengine";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { linkClicked } from "../links/signals";
import { db } from "../../core";
import { member } from "../../gates";
import { daily } from "../../schema";

on(
  linkClicked,
  flow({
    // a second consumer of the same signal
    do: async ({ code, at }, fx) => {
      const day = new Date(at).toISOString().slice(0, 10);
      const [row] = await fx
        .store(db)
        .select()
        .from(daily)
        .where(and(eq(daily.code, code), eq(daily.day, day)))
        .limit(1);

      if (row) await fx.store(db).increment(daily, row.id, "clicks");
      else await fx.store(db).insert(daily).values({ id: fx.id(), code, day, clicks: 1 });
    },
  }),
);

export const report = on(
  http.get("/links/:code/report").gate(member),
  flow({
    out: z.array(z.object({ day: z.string(), clicks: z.number() })),
    do: ({ code }, fx) =>
      fx
        .store(db)
        .select({ day: daily.day, clicks: daily.clicks })
        .from(daily)
        .where(eq(daily.code, code)),
  }),
);
