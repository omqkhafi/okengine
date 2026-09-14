import { on, flow, clock } from "okengine/http";
import { and, isNull, lte } from "drizzle-orm";

import { db, redirects } from "@/core";
import { links } from "@/db/schema";

/** Hourly sweep of expired links. */
const expireClock = clock.every("links.expire", "1h");

/**
 * Hourly sweep — archive past `expiresAt` and drop KV.
 *
 * One UPDATE stamps live rows past `fx.clock.now()` (not SQL `now()`).
 * KV has no WHERE, so codes still delete one at a time after the stamp.
 * Public `GET /:code` then 404s.
 */
export const expire = on(
  expireClock,
  flow({
    do: async (_input, fx) => {
      const archivedAt = fx.clock.now();
      const expired = and(isNull(links.archivedAt), lte(links.expiresAt, archivedAt));
      const rows = await fx.store(db).select({ code: links.code }).from(links).where(expired);
      if (rows.length === 0) return { archived: 0 };

      await fx.store(db).update(links).set({ archivedAt }).where(expired);
      for (const row of rows) {
        await fx.store(redirects).delete(String(row.code));
      }
      return { archived: rows.length };
    },
  }),
);
