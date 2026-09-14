import { on, flow, http } from "okengine/http";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db, member } from "@/core";
import { links } from "@/db/schema";
import { LinkListOut } from "./shapes";

/**
 * List the caller's active (non-archived) links, newest first.
 *
 * Owner filter lives in `do` — SELECT RLS is open for public redirect.
 * Pagination `meta` comes from the HTTP query via `fx.json.withQuery`.
 */
export const list = on(
  http.get({ out: LinkListOut }).gate(member),
  flow({
    do: async (input, fx) => {
      const userId = fx.auth.userId ?? "";
      const rows = await fx
        .store(db)
        .select()
        .from(links)
        .where(and(eq(links.userId, userId), isNull(links.archivedAt)))
        .orderBy(desc(links.createdAt));
      return fx.json.withQuery(rows, input);
    },
  }),
);
