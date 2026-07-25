---
title: "Linkly"
description: "Intermediate — Signal, Clock, Gate, delivery physics."
source: "docs/spec/four-applications.md"
---

> **Intermediate — Signal, Clock, Gate, delivery physics.**
>
> Scaffold: `bunx create-oke@latest my-linkly --from-example linkly` then `oke dev` (app `:6530`, Console `:6533`).

## 2 · INTERMEDIATE — Linkly

A URL shortener that counts clicks.

**New ideas:** `signal` and its three delivery physics · `clock` · `gate` · triggers beyond HTTP · transactional emit · cross-unit decoupling.

```
linkly/
├── oke.config.ts
├── src/
│   ├── app.ts
│   ├── core.ts
│   ├── gates.ts
│   ├── schema.ts
│   └── flows/
│       ├── links/
│       │   ├── index.ts
│       │   ├── shapes.ts
│       │   └── signals.ts
│       └── analytics/index.ts
└── tests/linkly.test.ts
```

### `examples/linkly/oke.config.ts`

```typescript
import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store:  { sql: { dev: "sqlite", test: "memory", prod: "postgres" },
              kv:  { dev: "memory", test: "memory", prod: "redis" } },
    signal: { dev: "memory", test: "memory", prod: "postgres" },
    clock:  { dev: "memory", test: "frozen", prod: "postgres" },
  },
});
```

`signal` defaults to `postgres`, and the reason is correctness rather than throughput — see the note after `redirect` below.

### `examples/linkly/src/gates.ts`

```typescript
import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const fair = gate.rate({
  strategy: "sliding-window-counter",   // near-exact, two keys, no boundary bursts
  max: 60, per: "1m", keyBy: "ip",
});
```

Five strategies exist (`fixed-window`, `sliding-log`, `token-bucket`, `leaky-bucket`); this one is the default because it has the best accuracy-to-cost ratio.

### `examples/linkly/src/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const links = sqliteTable("links", {
  id:        text("id").primaryKey(),               // `increment` targets this column
  code:      text("code").notNull().unique(),        // the short, human-facing key
  url:       text("url").notNull(),
  userId:    text("user_id").notNull(),
  clicks:    integer("clicks").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const daily = sqliteTable("daily", {
  id:     text("id").primaryKey(),
  code:   text("code").notNull(),
  day:    text("day").notNull(),                      // "YYYY-MM-DD"
  clicks: integer("clicks").notNull().default(0),
});
```

A generated `id` plus a separate unique `code` is the standard shape for a shortener: `increment` — see below — is a store-level primitive that targets a row by its primary key, so every table it touches needs one.

### `examples/linkly/src/flows/links/signals.ts`

```typescript
import { signal } from "okengine";
import { z } from "zod";

export const linkClicked = signal("link-clicked", {
  schema: z.object({ code: z.string(), at: z.number(), referrer: z.string().optional() }),
  delivery: "once",                       // queue physics: one consumer, retries, DLQ
  retries: 3, deadLetter: true,
});

export const linkStats = signal("link-stats", {
  schema: z.object({ code: z.string(), clicks: z.number() }),
  delivery: "live",                       // stream physics: clients subscribe
});
```

**`delivery` is mandatory with no default.** Queue, pub/sub and stream were always the same object with different delivery physics, so physics is an option — but choosing it is a semantic decision and guessing it produces silent, expensive bugs.

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

**Why `emit` inside the transaction matters.** The dual-write bug is the most common distributed-systems mistake: you write the record, then publish the message; a crash between them loses the message, or a rollback after publishing sends mail about something that does not exist. On the Postgres driver `fx.emit` enrols in the same transaction as `fx.store` writes, automatically. When you later switch to `redis` or `nats` for throughput, the driver keeps an outbox relay internally, so the guarantee does not regress — the upgrade is purely about speed.

### `examples/linkly/src/flows/analytics/index.ts`

```typescript
import { on, flow, http } from "okengine";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { linkClicked } from "../links/signals";
import { db } from "../../core";
import { member } from "../../gates";
import { daily } from "../../schema";

on(linkClicked, flow({                    // a second consumer of the same signal
  do: async ({ code, at }, fx) => {
    const day = new Date(at).toISOString().slice(0, 10);
    const [row] = await fx.store(db).select().from(daily)
      .where(and(eq(daily.code, code), eq(daily.day, day))).limit(1);

    if (row) await fx.store(db).increment(daily, row.id, "clicks");
    else await fx.store(db).insert(daily).values({ id: fx.id(), code, day, clicks: 1 });
  },
}));

export const report = on(http.get("/links/:code/report").gate(member), flow({
  out: z.array(z.object({ day: z.string(), clicks: z.number() })),
  do: ({ code }, fx) => fx.store(db).select({ day: daily.day, clicks: daily.clicks })
    .from(daily).where(eq(daily.code, code)),
}));
```

This unit never imports anything from `links` except the signal declaration. Decoupling is structural, not a discipline.

### `examples/linkly/src/app.ts`

```typescript
import { oke } from "okengine";
import * as links from "./flows/links";
import * as analytics from "./flows/analytics";

export const app = oke({ name: "linkly" }).adopt({ links, analytics });

export type App = typeof app;
```

#### The client — realtime with no realtime code

```typescript
const { data, error } = await api.links.shorten({ url: "https://example.com", code: "sa" });
if (error?.code === "Taken") suggestAnother();

api.signals.linkStats.subscribe(({ code, clicks }) => paint(code, clicks));
```

### `examples/linkly/tests/linkly.test.ts`

```typescript
const t = await createTestApp(app);                 // memory drivers, frozen clock
const u = await t.auth.loginAs({});

await t.api.links.shorten({ url: "https://example.com", code: "sa" }, { as: u });
await t.api.links.redirect({ code: "sa" });
await t.signals.drain();                            // run queued work deterministically

const { data } = await t.api.links.report({ code: "sa" }, { as: u });
expect(data![0].clicks).toBe(1);

await t.clock.advance("31d");
await t.cron.run("1h");                             // time travel
```

#### What you have

Seven exports, five elements, and five different trigger kinds — all of them the same `flow` object. There is no separate API for endpoints, consumers, cron jobs or internal functions.

#### What is missing

Nothing here survives a deploy. A payment that must wait two minutes for confirmation, an email that must actually reach a person, an order page that updates itself — none of that is expressible yet.

---
---
