import { on, flow, clock } from "okengine/http";
import { eq, inArray } from "drizzle-orm";

import { db, reachDigestMail } from "@/core";
import { daily, links } from "@/db/schema";
import { utcDay } from "./_shared";

/** Daily 09:00 UTC Reach digest. */
const reachClock = clock.daily("links.reach", { at: "09:00" });

/**
 * Daily Reach digest (`clock.daily` 09:00 UTC).
 *
 * Yesterday’s `daily` rows, grouped by link owner, one demo inbox.
 */
export const reach = on(
  reachClock,
  flow({
    plane: "operator",
    do: async (_input, fx) => {
      const day = utcDay(fx.clock.ago("1d"));
      const rows = await fx
        .store(db)
        .select({ code: daily.code, clicks: daily.clicks })
        .from(daily)
        .where(eq(daily.day, day));
      const codes = [...new Set(rows.map((row) => String(row.code)))];

      const ownerByCode = new Map<string, string>();
      if (codes.length > 0) {
        const owners = await fx
          .store(db)
          .select({ code: links.code, userId: links.userId })
          .from(links)
          .where(inArray(links.code, codes));
        for (const link of owners) {
          ownerByCode.set(String(link.code), String(link.userId));
        }
      }

      const totals = new Map<string, number>();
      for (const row of rows) {
        const userId = ownerByCode.get(String(row.code));
        if (!userId) continue;
        totals.set(userId, (totals.get(userId) ?? 0) + Number(row.clicks));
      }
      const owners = [...totals.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([userId, clicks]) => ({ userId, clicks }));
      const total = owners.reduce((sum, o) => sum + o.clicks, 0);

      await fx.send(reachDigestMail, {
        to: "you@localhost",
        data: { day, total, owners },
      });
      return { day, total, owners };
    },
  }),
);
