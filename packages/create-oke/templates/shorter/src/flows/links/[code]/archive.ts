import { on, flow, http, isFlowFailure } from "okengine/http";
import { eq } from "drizzle-orm";

import { db, linksMutate, redirects } from "@/core";
import { links } from "@/db/schema";
import { loadOwnedLink } from "../_shared";
import { Forbidden, LinkCodeIn, LinkOut, NotFound } from "../shapes";

/**
 * Soft-archive a link the caller owns.
 *
 * 1. Owner check in `do` (SELECT RLS is open)
 * 2. Stamp `archivedAt` from `fx.clock`
 * 3. Drop KV so `GET /:code` cannot 302 an archived link
 */
export const archive = on(
  http
    .post({ in: LinkCodeIn, out: LinkOut, errors: { NotFound, Forbidden } })
    .gate(linksMutate),
  flow({
    do: async (input, fx) => {
      const row = await loadOwnedLink(fx, input.code);
      if (isFlowFailure(row)) return row;

      // Store coerces epoch-ms → Date; `out` projects `*At` ms → ISO.
      const archivedAt = fx.clock.now();
      await fx.store(db).update(links).set({ archivedAt }).where(eq(links.id, row.id));
      await fx.store(redirects).delete(input.code);
      return { ...row, archivedAt };
    },
  }),
);
