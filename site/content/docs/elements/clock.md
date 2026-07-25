---
title: "Clock"
description: "time — Cron, delay, timeout, durable sleep, and TTL — time as an element, not a bolted-on scheduler library."
source: "docs/spec/unified-theory.md"
---

Clock is the element for **time**.

Cron, delay, timeout, durable sleep, and TTL — time as an element, not a bolted-on scheduler library.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Clock** | cron · delay · timeout · durable sleep · TTL | time |

## Example from the teaching apps

Claimed fence from **linkly** — same source the doc-drift gate checks:

### `examples/linkly/src/flows/links/index.ts`

```typescript
import { on, flow, http, every } from "okengine";
import { eq, lt } from "drizzle-orm";
import { db } from "../../core";
import { member, fair } from "../../gates";
import { linkClicked, linkStats } from "./signals";
import { NewLink, LinkCode, Link, NotFound, Taken } from "./shapes";
import { links } from "../../schema";

// ① HTTP — "an endpoint"
export const shorten = on(http.post("/links").gate(member, fair), flow({
  in: NewLink, out: LinkCode, errors: { Taken },
  do: async ({ url, code }, fx) => {
    if (await fx.store(db).exists(links, { code })) return fx.fail("Taken", {});
    const id = fx.id();
    await fx.store(db).insert(links).values(
      { id, code, url, userId: fx.auth.userId, clicks: 0, createdAt: Date.now() });
    return { code };
  },
}));

// ② HTTP — the hot path
export const redirect = on(http.get("/:code").gate(fair), flow({
  in: LinkCode, out: Link, errors: { NotFound },
  do: async ({ code }, fx) => {
    const [link] = await fx.store(db).select().from(links).where(eq(links.code, code)).limit(1);
    if (!link) return fx.fail("NotFound", {});

    await fx.emit(linkClicked, { code, at: Date.now() });   // same transaction as any write
    return link;
  },
}));

// ③ SIGNAL — "a queue consumer", and the same species as ① and ②
on(linkClicked, flow({
  do: async ({ code }, fx) => {
    const [link] = await fx.store(db).select().from(links).where(eq(links.code, code)).limit(1);
    const clicks = await fx.store(db).increment(links, link.id, "clicks");
    await fx.emit(linkStats, { code, clicks });             // live: pushed to subscribers
  },
}));

// ④ CLOCK — "a cron job", and still the same species
on(every("1h"), flow({
  do: (_, fx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;   // 30 days
    return fx.store(db).delete(links).where(lt(links.createdAt, cutoff));
  },
}));

// ⑤ A plain flow with no trigger — callable, not "private"
export const stats = flow({
  in: LinkCode, out: z.object({ clicks: z.number() }),
  do: async ({ code }, fx) => {
    const [link] = await fx.store(db).select({ clicks: links.clicks })
      .from(links).where(eq(links.code, code)).limit(1);
    return link ?? { clicks: 0 };
  },
});
```

## Next

- [Gate](/docs/elements/gate)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
