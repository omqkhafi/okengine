import { z } from "zod";
import { on, flow, http, every } from "okengine";
import { db } from "../../core";
import { member, fair } from "../../gates";
import { linkClicked, linkStats } from "./signals";
import { NewLink, LinkCode, Link, NotFound, Taken } from "./shapes";
import { links } from "../../schema";

// ① HTTP — "an endpoint"
export const shorten = on(http.post("/links").gate(member, fair), flow({
  in: NewLink, out: LinkCode, errors: { Taken },
  do: async ({ url, code }, fx) => {
    if (await fx.store(db).exists(links, code)) return fx.fail("Taken", {});
    await fx.store(db).insert(links).values({ code, url, userId: fx.auth.userId, clicks: 0 });
    return { code };
  },
}));

// ② HTTP — the hot path
export const redirect = on(http.get("/:code").gate(fair), flow({
  in: LinkCode, out: Link, errors: { NotFound },
  do: async ({ code }, fx) => {
    const link = await fx.store(db).findByCode(links, code);
    if (!link) return fx.fail("NotFound", {});

    await fx.emit(linkClicked, { code, at: Date.now() });   // same transaction as any write
    return link;
  },
}));

// ③ SIGNAL — "a queue consumer", and the same species as ① and ②
on(linkClicked, flow({
  do: async ({ code }, fx) => {
    const clicks = await fx.store(db).increment(links, code, "clicks");
    await fx.emit(linkStats, { code, clicks });             // live: pushed to subscribers
  },
}));

// ④ CLOCK — "a cron job", and still the same species
on(every("1h"), flow({
  do: (_, fx) => fx.store(db).deleteExpired(links, "30d"),
}));

// ⑤ A plain flow with no trigger — callable, not "private"
export const stats = flow({
  in: LinkCode, out: z.object({ clicks: z.number() }),
  do: ({ code }, fx) => fx.store(db).getClicks(links, code),
});
