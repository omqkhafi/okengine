import { on, flow, http, every } from "okengine";
import { z } from "zod";

import { draftsKv, member } from "@/core";
import { IdIn, IdOut, Ok } from "@/lib/shapes";
import { draftExpired } from "./signals";

import "./signals";

const DraftIn = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
});

/** List compose drafts. */
export const list = on(
  http.get("/drafts").gate(member),
  flow("drafts.list", {
    out: z.object({
      items: z.array(z.object({ id: z.string(), title: z.string() })),
      count: z.number(),
    }),
    do: async (_input, fx) => {
      const keys = await fx.store(draftsKv).list();
      const items: { id: string; title: string }[] = [];
      for (const key of keys) {
        const value = (await fx.store(draftsKv).get(key)) as { title?: string } | null;
        items.push({ id: key, title: value?.title ?? key });
      }
      return { items, count: items.length };
    },
  }),
);

/** Save a draft. */
export const save = on(
  http.put("/drafts/:id").gate(member),
  flow("drafts.save", {
    in: DraftIn,
    out: IdOut,
    do: async (input, fx) => {
      await fx.store(draftsKv).set(input.id, { title: input.title, body: input.body ?? "" }, "7d");
      return { id: input.id };
    },
  }),
);

/** Discard a draft. */
export const discard = on(
  http.delete("/drafts/:id").gate(member),
  flow("drafts.discard", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      await fx.store(draftsKv).delete(input.id);
      return { ok: true as const };
    },
  }),
);

/** Expire stale drafts (KV TTL + signal). */
export const expire = on(
  every("10m"),
  flow("drafts.expire", {
    plane: "operator",
    do: async (_input, fx) => {
      const keys = await fx.store(draftsKv).list();
      for (const key of keys) {
        const ttl = await fx.store(draftsKv).ttlMs(key);
        if (ttl !== null && ttl <= 0) {
          await fx.store(draftsKv).delete(key);
          await fx.emit(draftExpired, { id: key });
        }
      }
    },
  }),
);
