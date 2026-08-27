import { on, flow, http, fail, store } from "okengine";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, member } from "@/core";
import { inbox } from "@/db/schema.decl";
import { inboxZod } from "@/db/zod";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { IdIn, NotFound, Ok } from "@/lib/shapes";

const InboxHit = inboxZod.select.pick({
  id: true,
  kind: true,
  title: true,
  refId: true,
  readAt: true,
});

/**
 * Live query surface for the member inbox — `GET /inbox/live` streams
 * classified upsert/revoked/delete events. Clients filter to their own rows
 * with `?memberEmail=eq.<userId>` (same PostgREST grammar as list).
 */
const inboxR = store.resource(db, inbox, {
  in: z.object({
    memberEmail: z.string().email(),
    kind: z.string().min(1),
    title: z.string().min(1),
    refId: z.string().min(1),
  }),
  out: InboxHit,
  live: true,
});

if (inboxR.live) {
  on(http.get("/inbox/live").gate(member).live({ name: inboxR.live.signal }), inboxR.live.flow);
}

/** Inbox for the signed-in member. */
export const list = on(
  http.get("/inbox").gate(member),
  flow("inbox.list", {
    in: listIn({ mode: "offset" }),
    out: pageOut(InboxHit),
    do: async (input, fx) => {
      const email = fx.auth.userId ?? "";
      const rows = await fx.store(db).select().from(inbox);
      const items = rows
        .filter((r) => String(r.memberEmail) === email)
        .map((r) => ({
          id: String(r.id),
          kind: String(r.kind),
          title: String(r.title),
          refId: String(r.refId),
          readAt: r.readAt == null ? null : String(r.readAt),
        }));
      return fx.json.with(queryPage(items, input, { mode: "offset", search: ["title", "kind"] }));
    },
  }),
);

/** Mark one inbox row read. */
export const read = on(
  http.post("/inbox/:id/read").gate(member),
  flow("inbox.read", {
    in: IdIn,
    out: Ok,
    errors: { NotFound },
    do: async (input, fx) => {
      const row = await fx.store(db).findById(inbox, input.id);
      if (!row) return fail("NotFound", { id: input.id });
      const readAt = new Date(fx.clock.now()).toISOString();
      await fx.store(db).update(inbox).set({ readAt }).where(eq(inbox.id, input.id));
      return { ok: true as const };
    },
  }),
);
