import { on, flow, http, isFlowFailure } from "okengine/http";
import { asc, eq } from "drizzle-orm";

import { db, member } from "@/core";
import { daily } from "@/db/schema";
import { loadOwnedLink } from "../_shared";
import { Forbidden, LinkCodeIn, LinkReportOut, NotFound } from "../shapes";

/**
 * Daily click rows for a link the caller owns.
 *
 * 1. Owner check on `links` in `do`
 * 2. `daily` is not RLS-gated — ownership already checked
 */
export const report = on(
  http
    .get({ in: LinkCodeIn, out: LinkReportOut, errors: { NotFound, Forbidden } })
    .gate(member),
  flow({
    do: async (input, fx) => {
      const row = await loadOwnedLink(fx, input.code);
      if (isFlowFailure(row)) return row;

      const days = await fx
        .store(db)
        .select({ day: daily.day, clicks: daily.clicks })
        .from(daily)
        .where(eq(daily.code, input.code))
        .orderBy(asc(daily.day));
      return { code: input.code, clicks: row.clicks, days };
    },
  }),
);
