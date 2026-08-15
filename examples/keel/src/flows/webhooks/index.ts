import { on, flow, http } from "okengine";
import { z } from "zod";

import { webhookAdminWrite, webhookSecret, webhooksKv } from "@/core";
import { listIn, pageOut } from "@/lib/http";
import { IdIn, IdOut, Ok } from "@/lib/shapes";

const WebhookIn = z.object({
  url: z.string().min(1),
  events: z.array(z.string()).optional(),
});

/** List outbound webhooks. */
export const list = on(
  http.get("/webhooks").gate(webhookAdminWrite),
  flow("webhooks.list", {
    in: listIn({ mode: "offset" }),
    out: pageOut(z.object({ id: z.string(), url: z.string() })),
    do: async (input, fx) => {
      await fx.vault.get(webhookSecret);
      const keys = await fx.store(webhooksKv).list();
      const items: { id: string; url: string }[] = [];
      for (const key of keys) {
        const value = (await fx.store(webhooksKv).get(key)) as { url?: string } | null;
        items.push({ id: key, url: value?.url ?? "" });
      }
      return fx.json.withQuery(items, input);
    },
  }),
);

/** Register a webhook. */
export const create = on(
  http.post("/webhooks").gate(webhookAdminWrite),
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
  http.delete("/webhooks/:id").gate(webhookAdminWrite),
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
  http.post("/webhooks/:id/rotate").gate(webhookAdminWrite),
  flow("webhooks.rotate", {
    in: IdIn,
    out: Ok,
    do: async (_input, fx) => {
      await fx.vault.get(webhookSecret);
      return { ok: true as const };
    },
  }),
);
