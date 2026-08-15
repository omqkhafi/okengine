import { on, flow, http } from "okengine";
import { z } from "zod";

import { member, webhookAdmin, webhookSecret, webhooksKv } from "@/core";
import { IdIn, IdOut, Ok } from "@/lib/shapes";

const WebhookIn = z.object({
  url: z.string().min(1),
  events: z.array(z.string()).optional(),
});

/** List outbound webhooks. */
export const list = on(
  http.get("/webhooks").gate(member, webhookAdmin),
  flow("webhooks.list", {
    out: z.object({
      items: z.array(z.object({ id: z.string(), url: z.string() })),
      count: z.number(),
    }),
    do: async (_input, fx) => {
      await fx.vault.get(webhookSecret);
      const keys = await fx.store(webhooksKv).list();
      const items: { id: string; url: string }[] = [];
      for (const key of keys) {
        const value = (await fx.store(webhooksKv).get(key)) as { url?: string } | null;
        items.push({ id: key, url: value?.url ?? "" });
      }
      return { items, count: items.length };
    },
  }),
);

/** Register a webhook. */
export const create = on(
  http.post("/webhooks").gate(member, webhookAdmin),
  flow("webhooks.create", {
    in: WebhookIn,
    out: IdOut,
    do: async (input, fx) => {
      await fx.vault.get(webhookSecret);
      const id = fx.id();
      await fx.store(webhooksKv).set(id, { url: input.url, events: input.events ?? [] });
      return { id };
    },
  }),
);

/** Delete a webhook. */
export const remove = on(
  http.delete("/webhooks/:id").gate(member, webhookAdmin),
  flow("webhooks.delete", {
    in: IdIn,
    out: Ok,
    do: async (input, fx) => {
      await fx.vault.get(webhookSecret);
      await fx.store(webhooksKv).delete(input.id);
      return { ok: true as const };
    },
  }),
);

/** Rotate the signing secret (reads the contract — no outbound call). */
export const rotate = on(
  http.post("/webhooks/:id/rotate").gate(member, webhookAdmin),
  flow("webhooks.rotate", {
    in: IdIn,
    out: Ok,
    do: async (_input, fx) => {
      await fx.vault.get(webhookSecret);
      return { ok: true as const };
    },
  }),
);
