import { on, flow, signal } from "okengine";
import type { Fx } from "okengine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, linkCreatedMail } from "@/core";
import { daily, links } from "@/db/schema";
import { utcDay } from "./_shared";

/** Fired after a link is persisted — subscriber sends email. */
export const linkCreated = signal.once("link-created", {
  retries: 3,
  deadLetter: true,
  schema: z.object({
    id: z.string(),
    code: z.string(),
    url: z.string(),
    shortUrl: z.string(),
  }),
});

/** On create → send the short URL to the demo inbox. */
export const onCreated = on(
  linkCreated,
  flow("links.onCreated", {
    do: async (payload, fx) => {
      await fx.send(linkCreatedMail, {
        to: "you@localhost",
        data: {
          id: payload.id,
          code: payload.code,
          url: payload.url,
          shortUrl: payload.shortUrl,
        },
      });
    },
  }),
);

/** Fired on public redirect — subscriber increments clicks + daily. */
export const linkClicked = signal.once("link-clicked", {
  retries: 3,
  deadLetter: true,
  schema: z.object({
    code: z.string(),
  }),
});

/**
 * Increment PK `links.clicks` and upsert today's `daily` row.
 *
 * Missing row is a no-op (archived / deleted between redirect and drain).
 *
 * @param fx - Flow effects
 * @param code - Short code from `link-clicked`
 */
async function recordClick(fx: Fx, code: string): Promise<void> {
  const [row] = await fx.store(db).select({ id: links.id }).from(links).where(eq(links.code, code));
  if (!row) return;
  await fx.store(db).increment(links, String(row.id), "clicks");
  const day = utcDay(fx.clock.now());
  const [existing] = await fx
    .store(db)
    .select({ id: daily.id })
    .from(daily)
    .where(and(eq(daily.code, code), eq(daily.day, day)));
  if (existing) {
    await fx.store(db).increment(daily, String(existing.id), "clicks");
    return;
  }
  await fx.store(db).insert(daily).values({
    id: fx.id(),
    code,
    day,
    clicks: 1,
  });
}

/**
 * Off the redirect hot path — tally the click.
 *
 * 1. Increment `links.clicks` by PK
 * 2. Upsert `daily` for today's UTC day
 */
export const onClicked = on(
  linkClicked,
  flow("links.onClicked", {
    do: async (payload, fx) => {
      await recordClick(fx, payload.code);
    },
  }),
);
