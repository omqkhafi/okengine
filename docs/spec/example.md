# OKE — Four Applications
### A progressive path from one flow to a full system

**Package:** `okengine` · **CLI:** `oke`

Four complete, runnable applications. Each one introduces the smallest possible set of new ideas, and each ends by naming the limitation that motivates the next. Read them in order and the eight elements arrive one or two at a time instead of all at once.

| | App | Teaches | Elements | Exports | Files |
|---|---|---|---|---|---|
| **1 · Basic** | Notes | the one law · contracts · typed errors · the client | Flow · Store | 4 / 10 | 5 |
| **2 · Intermediate** | Linkly | one species, many triggers · delivery physics · transactional emit | + Signal · Clock · Gate | 7 / 10 | 11 |
| **3 · Advanced** | Provisions | durability · reaching humans · live queries · plugins | + Vault · Channel | 10 / 10 | 18 |
| **4 · Complex** | Skyport | AI and agents · tenancy · SLOs · distributed topology | all eight | all ten | 24 |

**The ten exports:** `on · flow · signal · store · clock · gate · vault · channel · ai · plugin`
**The one law:** `on(Trigger) → Effects`

---
---

# 1 · BASIC — Notes

**New ideas:** `oke`, `on`, `flow`, `http`, `store.sql`, `fx`, typed errors, the typed client.
**Time to running:** about two minutes.

```
notes/
├── oke.config.ts
├── src/
│   ├── app.ts
│   ├── core.ts
│   ├── schema.ts
│   └── flows/notes/index.ts
└── tests/notes.test.ts
```

Five files. Contracts live beside the flows that use them — a separate `shapes.ts` arrives in the next app, at the size where it starts to help.

### `oke.config.ts`

```typescript
import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: { sql: { dev: "sqlite", test: "memory", prod: "postgres" } },
  },
});
```

That is the whole configuration. Drivers are named after **protocols**, so `postgres` covers Postgres, Neon, Supabase and RDS alike.

### `src/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id, now } from "okengine/store";

export const notes = sqliteTable("notes", {
  id:        text("id").primaryKey().$defaultFn(id),
  title:     text("title").notNull(),
  body:      text("body").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
```

**Defaults belong in the schema.** `$defaultFn(id)` means no handler ever writes id-generation boilerplate. (`fx.id()` still exists and is required in one specific case — see the Store reference at the end.)

Drizzle is a **required peer dependency** — never bundled, always your version, and your schema file is yours. The framework commits to Drizzle rather than abstracting over ORMs, for a reason that is architectural rather than aesthetic; the Store reference explains it.

### `src/core.ts`

```typescript
import { store } from "okengine";
import * as schema from "./schema";

export const db = store.sql("notes", { schema });
```

### `src/flows/notes/index.ts`

```typescript
import { on, flow, http } from "okengine";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { db } from "../../core";
import { notes } from "../../schema";

// Contracts derived from the schema — one source of truth, refined where the API is stricter
const NewNote  = createInsertSchema(notes, { title: (s) => s.min(1).max(120) })
                   .omit({ id: true, createdAt: true });
const Note     = createSelectSchema(notes);
const NoteId   = z.object({ id: z.string() });
const NotFound = z.object({});

export const create = on(http.post("/notes"), flow({
  in: NewNote,
  out: NoteId,
  do: async (input, fx) => {
    const [note] = await fx.store(db).insert(notes).values(input).returning();
    return { id: note.id };
  },
}));
// effects → writes[sql:notes]

export const list = on(http.get("/notes"), flow({
  out: Note.array(),
  do: (_, fx) => fx.store(db).select().from(notes),
}));
// effects → reads[sql:notes]

export const get = on(http.get("/notes/:id"), flow({
  in: NoteId,
  out: Note,
  errors: { NotFound },
  do: async ({ id }, fx) => (await fx.store(db).findById(notes, id)) ?? fx.fail("NotFound", {}),
}));

export const remove = on(http.delete("/notes/:id"), flow({
  in: NoteId,
  errors: { NotFound },
  do: async ({ id }, fx) => {
    const deleted = await fx.store(db).delete(notes, id);
    if (!deleted) return fx.fail("NotFound", {});
  },
}));
```

**Four things to notice.**

`fx` is the only door to the outside world. Every read and every write passes through it — which is what lets the framework know that `create` writes `notes` and `list` reads it, with no annotation from you.

**Contracts are derived, not retyped.** `drizzle-zod` turns the table into request and response schemas, refined where the API should be stricter than storage. When the two genuinely diverge — internal columns, computed responses, a different input shape — write the schema by hand instead. Derive when they agree; hand-write when they don't.

**Errors are values, not exceptions.** `fx.fail("NotFound", {})` returns a typed error the client will narrow on. There is no `throw` and no `catch (e: any)`.

**No cache configuration appears anywhere.** `list` is cached automatically, and invalidated by exactly the writes that touch the rows it read — because the compiler knows both.

### `src/app.ts`

```typescript
import { oke } from "okengine";
import * as notes from "./flows/notes";

export const app = oke({ name: "notes" }).adopt({ notes });

export type App = typeof app;   // ← the client needs nothing else
```

`on()` still registers each flow with the router and the Manifest — `.adopt()` exists so the type of `app` accumulates every contract in `notes`, which is what lets the client below need no hand-written types and no separate codegen step. The namespace key (`notes`) becomes the client's namespace; each export becomes a method.

### The client

```typescript
import { createClient } from "okengine/client";
import type { App } from "../src/app";
import { app } from "../src/app";

const api = createClient<App>("http://localhost:6530", { $routes: app.$routes });
// equivalently: const api = createClient(app, "http://localhost:6530");

const { data, error } = await api.notes.get({ id: "n_1" });

if (error?.code === "NotFound") show("gone");
else console.log(data.title);          // ← typed, no codegen ✅
// GET /notes/n_1 — the method and path are derived from the flow's own trigger,
// not from a separate RPC convention.
```

### `tests/notes.test.ts`

```typescript
import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("create then read", async () => {
  const t = await createTestApp(app);            // memory driver, automatic
  const { data } = await t.api.notes.create({ title: "First", body: "Hello" });
  const { data: note } = await t.api.notes.get({ id: data!.id });
  expect(note!.title).toBe("First");
});
```

### Run it

```bash
bun add okengine
oke dev          # app :6530 · Console :6533 · MCP :6535
bun test
```

Open `:6533` and the Console already shows the four flows, their contracts, their effects, and a live architecture diagram — derived, not configured.

### What you have

Four exports (`oke`, `on`, `flow`, `store`), two elements, a typed client, automatic caching, and a Console.

### What is missing

Everything here is synchronous. A real application needs work that happens *later* — after the response, on a schedule, or in reaction to something. That is the next app.

---
---

# 2 · INTERMEDIATE — Linkly

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

### `oke.config.ts`

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

### `src/gates.ts`

```typescript
import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const fair = gate.rate({
  strategy: "sliding-window-counter",   // near-exact, two keys, no boundary bursts
  max: 60, per: "1m", keyBy: "ip",
});
```

Five strategies exist (`fixed-window`, `sliding-log`, `token-bucket`, `leaky-bucket`); this one is the default because it has the best accuracy-to-cost ratio.

### `src/schema.ts`

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

### `src/flows/links/signals.ts`

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

### `src/flows/links/index.ts`

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

### `src/flows/analytics/index.ts`

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

### `src/app.ts`

```typescript
import { oke } from "okengine";
import * as links from "./flows/links";
import * as analytics from "./flows/analytics";

export const app = oke({ name: "linkly" }).adopt({ links, analytics });

export type App = typeof app;
```

### The client — realtime with no realtime code

```typescript
const { data, error } = await api.links.shorten({ url: "https://example.com", code: "sa" });
if (error?.code === "Taken") suggestAnother();

api.signals.linkStats.subscribe(({ code, clicks }) => paint(code, clicks));
```

### `tests/linkly.test.ts`

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

### What you have

Seven exports, five elements, and five different trigger kinds — all of them the same `flow` object. There is no separate API for endpoints, consumers, cron jobs or internal functions.

### What is missing

Nothing here survives a deploy. A payment that must wait two minutes for confirmation, an email that must actually reach a person, an order page that updates itself — none of that is expressible yet.

---
---

# 3 · ADVANCED — Provisions

A subscription store: orders, payments, notifications.

**New ideas:** `durable` flows and the journal · `vault` · `channel` with fallback chains and i18n · live queries · plugins · a CDC trigger · the three cache tiers.

```
provisions/
├── oke.config.ts
├── src/
│   ├── app.ts
│   ├── core.ts            # the primary database
│   ├── gates.ts           # shared gates
│   ├── vault.ts           # every secret contract, one auditable file
│   ├── channels.ts        # how we reach humans
│   ├── locales/{en,ar}.ts
│   ├── plugins/audit.ts
│   ├── schema.ts
│   └── flows/
│       ├── orders/{index.ts,shapes.ts,signals.ts}
│       ├── payments/{index.ts,shapes.ts}
│       └── notifications/index.ts
└── tests/orders.test.ts
```

**The layout rule from here on: whoever *produces* an element declares it; consumers import it.** Shared concerns (the database, shared gates, secrets, channels) sit at the root. The framework never forces this — the Manifest is built from the import graph — but the tree teaches the vocabulary.

### `src/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  sku:   text("sku").primaryKey(),
  name:  text("name").notNull(),
  stock: integer("stock").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull(),
  sku:       text("sku").notNull(),
  qty:       integer("qty").notNull(),
  status:    text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});
```

### `src/vault.ts`

```typescript
import { vault } from "okengine";
import { z } from "zod";

// A declaration is a CONTRACT, not a value.
// Resolution: process.env → .env.local → .env.stack → vault driver → dev fallback
export const stripeKey = vault.secret("STRIPE_KEY", {
  schema: z.string().startsWith("sk_"),
  description: "Payments gateway key",
  rotate: "90d",
  dev: "sk_test_local",
});

export const dbUrl = vault.secret("DATABASE_URL", {
  schema: z.string().url(),
  dev: vault.fromStack("store.sql"),     // generated by `oke dev --stack` — zero manual setup
});
```

Missing or invalid at boot, `oke doctor` lists **all** of them at once with their descriptions — before a single request is served. Values are never readable from the Console; only fingerprints are shown.

### `src/channels.ts`

```typescript
import { channel } from "okengine";
import { z } from "zod";

export const mail = channel.email({ from: "Provisions <no-reply@provisions.sa>" });
export const sms  = channel.sms({ sender: "PROVISIONS" });
export const wa   = channel.whatsapp();

export const orderConfirmed = mail.template("order-confirmed", {
  schema: z.object({ name: z.string(), orderId: z.string(), total: z.number() }),
});

export const otpCode = channel.template("otp-code", {   // medium-agnostic
  schema: z.object({ code: z.string() }),
});
```

Recipient address, language and opt-out consent are resolved from the user automatically. In development the `console` driver puts every medium into a built-in inbox instead of sending.

### `src/flows/orders/index.ts`

```typescript
import { on, flow, gate, http } from "okengine";
import { eq } from "drizzle-orm";
import { db } from "../../core";
import { member } from "../../gates";
import { orderPlaced, orderNews } from "./signals";
import { chargeOrder } from "../payments";
import { NewOrder, OrderId, OrderRow, OutOfStock } from "./shapes";
import { orders, products } from "../../schema";

const canOrder = gate.policy("order:create", ({ auth }) => auth.scopes.has("order:create"));

export const create = on(http.post("/orders").gate(member, canOrder), flow({
  in: NewOrder, out: OrderId, errors: { OutOfStock },
  do: async (input, fx) => {
    const [product] = await fx.store(db).select({ stock: products.stock })
      .from(products).where(eq(products.sku, input.sku)).limit(1);
    if (!product || product.stock < input.qty) return fx.fail("OutOfStock",
      { left: product?.stock ?? 0 },
      { message: fx.t("order.outOfStock", { left: product?.stock ?? 0 }) });

    const id = fx.id();
    await fx.store(db).insert(orders).values(
      { id, userId: fx.auth.userId, ...input, status: "pending", createdAt: Date.now() });
    await fx.emit(orderPlaced, { orderId: id });
    return { id };
  },
}));

// LIVE QUERY — realtime and auto-caching from one flag
export const mine = on(http.get("/orders").gate(member).live(), flow({
  out: OrderRow.array(),
  do: (_, fx) => fx.store(db).select().from(orders).where(eq(orders.userId, fx.auth.userId)),
}));

export const getOrder = flow({
  in: OrderId, out: OrderRow,
  do: async ({ id }, fx) => {
    const [order] = await fx.store(db).select().from(orders).where(eq(orders.id, id)).limit(1);
    return order;
  },
});

// SIGNAL consumer
on(orderPlaced, flow({
  do: async ({ orderId }, fx) => {
    const paid = await fx.call(chargeOrder, { orderId });
    await fx.store(db).update(orders).set({ status: paid ? "confirmed" : "failed" })
      .where(eq(orders.id, orderId));
    await fx.emit(orderNews, { orderId, status: paid ? "confirmed" : "failed" });
  },
}));

// CHANGE trigger — CDC, built in
on(db.table(orders).changed("status"), flow({
  do: ({ before, after }, fx) => fx.log.info("status", { from: before.status, to: after.status }),
}));
```

**`.live()` is the whole of realtime.** The result is cached, invalidated by exactly the writes that touch those rows, and pushed to subscribed clients on exactly those writes. No cache code, no socket code.

### `src/flows/payments/index.ts` — durability is a flag

```typescript
import { flow } from "okengine";
import { z } from "zod";
import { stripeKey } from "../../vault";
import { OrderRef } from "./shapes";

export const chargeOrder = flow({
  durable: true,                    // every fx call below is journaled
  in: OrderRef, out: z.boolean(),
  do: async ({ orderId }, fx) => {
    const intent = await fx.step("create-intent", () =>       // never re-runs on replay
      stripe(fx.vault(stripeKey)).create(orderId));

    await fx.clock.sleep("verify-window", "2m");              // survives restart and deploy

    return fx.step("confirm", () => stripe(fx.vault(stripeKey)).confirm(intent));
  },
});
```

**Workflows are not a separate API.** They are ordinary flows with one option. A process killed between the two steps resumes at `confirm` — the card is not charged twice.

### `src/flows/notifications/index.ts` — reaching humans

```typescript
import { on, flow } from "okengine";
import { z } from "zod";
import { orderNews } from "../orders/signals";
import { getOrder } from "../orders";
import { orderConfirmed, otpCode, wa, sms } from "../../channels";

on(orderNews, flow({
  do: async ({ orderId, status }, fx) => {
    if (status !== "confirmed") return;
    const o = await fx.call(getOrder, { id: orderId });
    await fx.send(orderConfirmed, { to: o.userId, data: { name: o.userName, orderId, total: o.total } });
  },
}));

export const sendOtp = flow({
  in: z.object({ userId: z.string(), code: z.string() }),
  do: ({ userId, code }, fx) => fx.send(otpCode, { to: userId, via: [wa, sms], data: { code } }),
  //                                                     ↑ fallback chain: WhatsApp, else SMS
});
```

Fallback is recorded as a **chain**, not an outcome — so the Console can tell you that 23% of OTPs fell back to SMS this week and what that cost.

### `src/plugins/audit.ts` — every extension point in one file

```typescript
import { plugin, store } from "okengine";
import { z } from "zod";

export const audit = plugin("audit", { version: "1.0.0" })
  .config(z.object({ retain: z.string().default("2y") }))
  .element(store.sql("audit", { schema: () => import("./audit-schema") }))
  .needs("store.kv")
  .decorate("audit", { enabled: true })
  .hook("afterHandle", async (ctx, fx) => {
    if (ctx.trigger.meta?.audit) await fx.store("audit").log(ctx);
  })
  .errors({ AuditWriteFailed: z.object({ reason: z.string() }) })
  .consolePanel({ id: "audit", title: "Audit Trail", entry: "./panel.tsx" })
  .cli("audit:export", ({ fx }) => fx.store("audit").exportCsv());
```

### `src/app.ts` — scope is the attachment point

```typescript
import { oke } from "okengine";
import { auth } from "okengine/auth";
import { audit } from "./plugins/audit";
import * as orders from "./flows/orders";
import * as payments from "./flows/payments";
import * as notifications from "./flows/notifications";

export const app = oke({ name: "provisions" })
  .adopt({ orders, payments, notifications })
  .plug(auth())                       // zero ceremony: uses your configured store
  .plug(audit)                        // app-wide
  .hook("onError", (ctx, err, fx) => fx.log.error(err));

app.unit("orders").plug(rateLimit({ max: 30 }));  // this unit only

export type App = typeof app;
```

`app.plug()` is app-wide, `app.unit(name).plug()` covers one unit, `flow.plug()` covers one flow. **The position is the scope** — no `global: true`, no inheritance rule to remember. `.adopt()` is what makes `typeof app` carry every flow's contract for the client; `on()` inside each flow file still does the actual trigger registration.

**Auth needs no adapter.** The framework already knows your store; its tables come from `oke schema generate`. Options exist when you want them, and the identity provider is a seam — `auth({ provider: betterAuth(...) })`, `clerk()`, `supabase()`, `auth0()`, `kinde()` all normalise to the same `fx.auth`, so gates, ABAC, rate limits and channel recipients keep working unchanged when you switch.

### Cache — three visible tiers

```typescript
// Tier 1 — automatic for live and read flows; invalidation computed from effects
// Tier 2 — a flag on any flow
export const popular = on(http.get("/popular"), flow({ cache: "5m", do: /* … */ }));
// Tier 3 — manual
const rate = await fx.cache.getOrSet("fx-rate:USD-SAR", "1h", fetchRate);
```

### i18n

```typescript
// src/locales/ar.ts
export default { "order.outOfStock": "لم يتبقَّ سوى {left} قطع" };
```

Typed keys — a missing key is a compile error. Locale resolves per request: user profile → `Accept-Language` → configured default. Errors and channel templates are localised, and the `dir` flag reaches the client so the frontend gets RTL for free.

### `tests/orders.test.ts`

```typescript
const t = await createTestApp(app);                 // memory drivers, frozen clock
const u = await t.auth.loginAs({ scopes: ["order:create"] });

const { data } = await t.api.orders.create({ sku: "COFFEE", qty: 2 }, { as: u });
await t.signals.drain();
await t.clock.advance("2m");                        // the durable sleep elapses instantly
await t.signals.drain();

expect(t.channels.sent()).toContainEqual(
  expect.objectContaining({ template: "order-confirmed", to: u.id, locale: "ar" }));
```

### What you have

All ten exports and seven of the eight elements. Durable execution, human-facing delivery, realtime, plugins, i18n, and secrets with boot-time validation.

### What is missing

The system serves one customer, treats every user the same, and has no way to state what "working" means. It also cannot reason about anything.

---
---

# 4 · COMPLEX — Skyport

A membership and booking platform, multi-tenant, with AI.

**New ideas:** the `ai` element (models, prompts, RAG, agents) · multi-tenancy · SLOs and journeys · distributed topology · the three scaling axes.

```
skyport/
├── oke.config.ts
├── oke.images.lock
├── src/
│   ├── app.ts · core.ts · gates.ts · vault.ts · channels.ts · ai.ts
│   ├── locales/{en,ar}.ts · schema.ts · schema/oke.ts (generated)
│   ├── plugins/audit.ts
│   └── flows/
│       ├── bookings/{index.ts,shapes.ts,signals.ts}   # flights + FlightFull live here
│       ├── payments/{index.ts,shapes.ts}
│       ├── notifications/index.ts
│       ├── support/index.ts          # AI triage, RAG, a bounded agent
│       └── users/{index.ts,shapes.ts,elements.ts}
└── tests/
```

### `oke.config.ts` — the complete surface

```typescript
import { defineConfig } from "okengine/config";
import { dbUrl, dbReplica1, anthropicKey } from "./src/vault";

export default defineConfig({
  // Drivers are named after PROTOCOLS and bind through Bun's native clients
  // (Bun.sql, bun:sqlite, Bun.redis, Bun.S3) — zero npm client dependencies.
  drivers: {
    store: {
      sql: { dev: "sqlite", test: "memory",
             prod: { driver: "postgres", url: dbUrl, pool: { max: 20 },
                     replicas: [dbReplica1] } },      // read-only flows auto-route here
      kv:    { dev: "memory",   test: "memory", prod: "redis" },   // Redis · Valkey · Dragonfly
      files: { dev: "fs",       test: "memory", prod: "s3" },      // S3 · R2 · SeaweedFS · MinIO
      index: { dev: "pgvector", test: "memory", prod: "pgvector" },
    },
    signal:  { dev: "memory", test: "memory", prod: "postgres" },
    clock:   { dev: "memory", test: "frozen", prod: "postgres" },
    vault:   { dev: "dotenv", test: "memory", prod: "sops" },      // SOPS/age — committable
    runs:    { dev: "files",  test: "memory", prod: "files" },     // Parquet + DuckDB
    channel: {
      email:    { dev: "console", prod: "smtp" },
      sms:      { dev: "console", prod: "unifonic" },
      whatsapp: { dev: "console", prod: "wa-cloud" },
      push:     { dev: "console", prod: "fcm" },
    },
    ai: {
      dev:  "mock",                                   // deterministic — tests never call out
      prod: { driver: "anthropic", key: anthropicKey },
      // no prod default: model choice is never guessed.
      // "openai-compatible" covers vLLM · Groq · Together · LM Studio · most self-hosted
    },
  },

  images: {                                           // vendor choice, keyed by ROLE
    "store.sql": "pgvector/pgvector:pg17",
    "store.kv":  "valkey/valkey:8-alpine",
  },

  i18n:     { locales: ["en", "ar"], default: "ar", dir: { ar: "rtl" } },
  tenancy:  { resolve: (ctx) => ctx.auth.orgId, isolation: "row" },
  topology: "monolith",                               // flip to "services" — code unchanged
  ports:    { app: 6530, console: 6533, mcp: 6535 },  // O·K·E = 6·5·3
  console:  { prod: { enabled: true, auth: "required" } },
});
```

### `src/schema.ts` (excerpt — the tables this section uses)

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { id } from "okengine/store";

export const bookings = sqliteTable("bookings", {
  id:        text("id").primaryKey().$defaultFn(id),
  userId:    text("user_id").notNull(),
  flightId:  text("flight_id").notNull(),
  seats:     integer("seats").notNull(),
  status:    text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const flights = sqliteTable("flights", {
  id:    text("id").primaryKey(),
  seatsAvailable: integer("seats_available").notNull(),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(), subject: text("subject").notNull(),
  body: text("body").notNull(), urgency: text("urgency"), team: text("team"),
  summary: text("summary"),
});
```

### `src/flows/bookings/shapes.ts`

```typescript
import { z } from "zod";

export const NewBooking  = z.object({ flightId: z.string(), seats: z.number().min(1).max(9) });
export const BookingId   = z.object({ id: z.string() });
export const BookingRow  = z.object({ id: z.string(), status: z.string(), seats: z.number() });
export const FlightFull  = z.object({ seatsLeft: z.number() });
```

### `src/flows/bookings/signals.ts`

```typescript
import { signal } from "okengine";
import { z } from "zod";

export const orderPlaced = signal("order-placed", {
  schema: z.object({ orderId: z.string() }), delivery: "once", retries: 5, deadLetter: true,
});
export const seatFeed = signal("seat-feed", {
  schema: z.object({ flightId: z.string(), left: z.number() }), delivery: "live",
});
```

### `src/flows/bookings/index.ts`

```typescript
import { on, flow, gate, http } from "okengine";
import { eq } from "drizzle-orm";
import { db } from "../../core";
import { member, fair } from "../../gates";
import { orderPlaced, seatFeed } from "./signals";
import { NewBooking, BookingId, BookingRow, FlightFull } from "./shapes";
import { bookings, flights } from "../../schema";

export const canBook = gate.policy("booking:create", ({ auth }) => auth.scopes.has("booking:create"));

export const create = on(http.post("/bookings").gate(member, canBook, fair), flow({
  slo: { availability: "99.9%", latency: { p99: "200ms" } },
  in: NewBooking, out: BookingId, errors: { FlightFull },
  do: async ({ flightId, seats }, fx) => {
    const [flight] = await fx.store(db).select().from(flights).where(eq(flights.id, flightId)).limit(1);
    if (!flight || flight.seatsAvailable < seats)
      return fx.fail("FlightFull", { seatsLeft: flight?.seatsAvailable ?? 0 });

    const id = fx.id();
    await fx.store(db).insert(bookings).values(
      { id, userId: fx.auth.userId, flightId, seats, status: "pending", createdAt: Date.now() });
    await fx.emit(orderPlaced, { orderId: id });
    await fx.emit(seatFeed, { flightId, left: flight.seatsAvailable - seats });
    return { id };
  },
}));

export const mine = on(http.get("/bookings").gate(member).live(), flow({
  out: BookingRow.array(),
  do: (_, fx) => fx.store(db).select().from(bookings).where(eq(bookings.userId, fx.auth.userId)),
}));

export const getBooking = flow({
  in: BookingId, out: BookingRow,
  do: async ({ id }, fx) => {
    const [b] = await fx.store(db).select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return b;
  },
});

// The agent's second tool — refunding is a distinct, gated capability, never the same
// permission as reading a booking, since the agent's tool list is exactly its authority.
export const refundBooking = flow({
  in: BookingId, out: BookingRow,
  do: async ({ id }, fx) => {
    await fx.store(db).update(bookings).set({ status: "refunded" }).where(eq(bookings.id, id));
    const [b] = await fx.store(db).select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return b;
  },
});
```

### `src/ai.ts` — the eighth element

```typescript
import { ai, store } from "okengine";
import { z } from "zod";
import { getBooking, refundBooking } from "./flows/bookings";

export const smart = ai.model("smart", { provider: "anthropic", tier: "opus" });
export const fast  = ai.model("fast",  { provider: "anthropic", tier: "haiku" });

// A prompt is a VERSIONED ARTIFACT with a validated output shape — not a string in a handler
export const triage = smart.prompt("ticket-triage", {
  in:  z.object({ subject: z.string(), body: z.string() }),
  out: z.object({ urgency: z.enum(["low", "high"]), team: z.string(), summary: z.string() }),
  version: 3,
  evals: "./evals/triage.jsonl",          // regression-gated in CI via `oke eval`
  budget: { maxCostPerCall: 0.02 },       // cost is a first-class dimension
});

export const embed = ai.embed("docs", { model: fast, into: store.index("kb") });

// An agent whose tools are YOUR OWN FLOWS — each carrying its gates and effects
export const support = ai.agent("support", {
  model: smart,
  tools: [getBooking, refundBooking],
  maxSteps: 6,
  budget: { maxCostPerRun: 0.25 },
});
```

### `src/flows/support/index.ts`

```typescript
import { on, flow, http } from "okengine";
import { z } from "zod";
import { triage, support, embed, smart, fast } from "../../ai";
import { member } from "../../gates";
import { db } from "../../core";
import { tickets } from "../../schema";

// ① A prompt call with a provider fallback chain and a validated result
export const createTicket = on(http.post("/tickets").gate(member), flow({
  in:  z.object({ subject: z.string(), body: z.string() }),
  out: z.object({ id: z.string(), urgency: z.string() }),
  do: async (input, fx) => {
    const t = await fx.ask(triage, input, { via: [smart, fast] });
    const id = fx.id();
    await fx.store(db).insert(tickets).values({ id, ...input, ...t });
    return { id, urgency: t.urgency };
  },
}));
// effects → writes[sql:tickets] asks[ticket-triage v3] cost[~$0.01] nondeterministic

// ② RAG — retrieve, then answer with streaming tokens
export const askDocs = on(http.post("/ask").gate(member).live(), flow({
  in: z.object({ question: z.string() }),
  do: async ({ question }, fx) => {
    const context = await fx.search(embed, question, { topK: 5 });
    return fx.stream(smart, { prompt: "answer-with-context", data: { question, context } });
    // streaming reaches the client through the Signal element — no separate socket layer
  },
}));

// ③ A durable, bounded agent
export const supportAgent = on(http.post("/support").gate(member), flow({
  durable: true,                          // nondeterministic calls are ALWAYS journaled
  in: z.object({ message: z.string() }),
  do: ({ message }, fx) => fx.run(support, { message }),
  // the agent can only call getBooking and refundBooking, and only within THIS user's
  // gates and tenant scope — it cannot exceed what the code declares
}));
```

**What the compiler enforces here, for free:**

- A field tagged `pii` in the schema **cannot reach a third-party model** — the build fails unless the flow masks it or declares `allowPii` explicitly.
- `nondeterministic` forces journaling: on replay, a model is never re-called; the recorded answer is reused.
- Automatic caching is disabled for AI flows unless a semantic cache is explicitly enabled.
- Cost accumulates per flow, per tenant and per release — visible in the Console and in Manifest Diff *before* deploy.

### Declaring what "working" means

```typescript
// on a flow — this is bookings.create, shown in full above
export const create = on(http.post("/bookings").gate(member, canBook, fair), flow({
  slo: { availability: "99.9%", latency: { p99: "200ms" } },
  in: NewBooking, out: BookingId, errors: { FlightFull },
  do: /* as shown above */,
}));

// on a user journey — because a service SLO is not a user SLO
journey("book-a-flight", {
  path: [bookings.create, payments.charge, notifications.send],
  slo: { availability: "99.5%" },
});
```

Forty services at 99.9% in sequence yield 96.1% for the user. Because the causal chain is known, **the compiler rejects the impossible**: *"this path composes to 99.4% but declares 99.5%."* And because the objective lives in the Manifest, lowering a target is a code change that passes through Manifest Diff and team review — not a silent dashboard edit.

### Multi-tenancy as a dimension of `fx`

`tenancy: { resolve, isolation: "row" }` in the config is the whole of it. Every store call passes through `fx`, so tenant scoping applies automatically — there is no forgotten `WHERE org_id`. Rate limits, caches, secrets and channel branding become per-tenant for free, and **`oke doctor` fails the build** if any flow reads a tenant-scoped table without a tenant in context.

### The three scaling axes, never conflated

| Axis | Question | Mechanism |
|---|---|---|
| **Split** (`topology`) | one deployable, or one per unit? | `monolith` = in-process calls · `services` = a container per unit, `fx.call` becomes network — code unchanged |
| **Clone** (horizontal) | how many copies of the app? | run N instances: `once` signals deliver to exactly one, crons leader-elect, live queries fan out. `oke docker --prod` emits `deploy.replicas` |
| **Data replicas** | how many copies of the data? | `replicas:` on the driver; read-only flows auto-route, derived from effects |

### `src/app.ts`

```typescript
import { oke } from "okengine";
import { auth } from "okengine/auth";
import { audit } from "./plugins/audit";
import * as bookings from "./flows/bookings";
import * as payments from "./flows/payments";
import * as notifications from "./flows/notifications";
import * as support from "./flows/support";
import * as users from "./flows/users";

export const app = oke({ name: "skyport" })
  .adopt({ bookings, payments, notifications, support, users })
  .plug(auth())
  .plug(audit)
  .hook("onError", (ctx, err, fx) => fx.log.error(err));

export type App = typeof app;
```

Same shape as Provisions — `.adopt()` for the client's types, `.plug()` for cross-cutting concerns, `on()` inside each flow file for the actual trigger registration. Nothing about composition changes as an application grows from one unit to five.

### `tests/` — deterministic even with AI

```typescript
const t = await createTestApp(app);
t.ai.mock(triage, { urgency: "high", team: "ops", summary: "seat dispute" });

const u = await t.auth.loginAs({});
const { data } = await t.api.support.createTicket({ subject: "…", body: "…" }, { as: u });

expect(data!.urgency).toBe("high");
expect(t.ai.cost()).toBeLessThan(0.02);        // budgets are assertable
```

### What you have

All eight elements, all ten exports, and one law.

---
---

# REFERENCE

## What the compiler produced — `manifest.oke.json`

```json
{
  "oke": "1.0",
  "app": "skyport",
  "flows": {
    "bookings.create": {
      "trigger": { "http": { "method": "POST", "path": "/bookings" } },
      "gates": ["member", "booking:create", "rate:sliding-window-counter:300/1m"],
      "in": "…", "out": "…", "errors": ["FlightFull"],
      "effects": {
        "reads":  ["sql:bookings"],
        "writes": ["sql:bookings"],
        "emits":  ["order-placed", "seat-feed"],
        "secrets": []
      },
      "slo": { "availability": "99.9%", "latency": { "p99": "200ms" } },
      "source": "src/flows/bookings/index.ts:18"
    },
    "bookings.mine": { "live": true, "cacheKeys": "computed:sql:bookings/userId" },
    "payments.chargeBooking": { "durable": true, "steps": ["create-intent", "confirm"],
                                "effects": { "secrets": ["STRIPE_KEY"] } },
    "support.createTicket": {
      "effects": { "writes": ["sql:tickets"], "asks": ["ticket-triage@3"] },
      "nondeterministic": true,
      "cost": { "estimatePerCall": 0.011, "budget": 0.02 },
      "pii": "masked"
    }
  },
  "signals": {
    "order-placed": { "delivery": "once", "retries": 5, "deadLetter": true },
    "seat-feed":    { "delivery": "live" }
  },
  "channels": { "booking-confirmed": { "medium": "email", "locales": ["en", "ar"] } },
  "ai": {
    "models":  { "smart": { "provider": "anthropic", "tier": "opus" } },
    "prompts": { "ticket-triage": { "version": 3, "evals": "./evals/triage.jsonl" } },
    "agents":  { "support": { "tools": ["bookings.getBooking", "bookings.refundBooking"],
                              "maxSteps": 6 } }
  },
  "journeys": { "book-a-flight": { "slo": { "availability": "99.5%" }, "composes": "99.6%" } },
  "drivers": { "prod": ["postgres", "redis", "s3", "smtp", "sops", "anthropic", "pgvector"] },
  "tenancy": { "isolation": "row" }
}
```

From this one file OKE derives: the typed client · OpenAPI + AsyncAPI · the Console catalogue, diagrams and traces · per-flow capabilities · cache invalidation keys · replica routing · the tree-shaken bundle · the Dockerfile and compose files · the MCP surface.

## Commands

```bash
bun add okengine                 # ONE package

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535
                                 #   → also auto-syncs client types on every save
oke dev --stack                  # -s  also boot the real infra stack (generated compose)
oke dev -s store.sql,signal      #     partial: only these roles get real backends

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke stack                        # preview resolved images/tags/ports — writes nothing

oke schema generate              # core + plugin tables → schema/oke.ts   (--check in CI)
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # Dockerfile + compose.store.sql.yml · compose.store.kv.yml · …
oke docker --prod                # healthchecks, volumes, limits, secret refs, deploy.replicas
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```

## The Console at `:6533`

Seventeen panels, all derived and never hand-maintained: **Overview · Flows · Signals · Store · Clock · Gates · Vault · Channels · AI · Architecture · Traces · Runs · Manifest Diff · Access · Plugins**, plus **Privacy** and **Tenancy** when their optional core plugins are plugged.

Runtime actions execute directly; structural changes arrive as reviewable diffs in your working tree. Every Console action is a real flow through `fx`, so **the audit log is the trace**.

## Store reference

**Why Drizzle is a required peer dependency, not an abstraction.** The framework commits to one query builder rather than supporting several, because the effect inferencer performs real static analysis on Drizzle's own shapes — a table object, `.select().from(t)`, `.insert(t).values()` — to derive `reads`/`writes`/PII classification with no annotation from you. Supporting N ORMs would mean either analysing N different query builders (and getting it wrong for the ones nobody tests) or falling back to hints, which is exactly the annotation burden the effect system exists to remove. One committed ORM is what makes automatic cache invalidation and least-privilege capability tokens possible at all.

**When you still need `fx.id()` despite `$defaultFn(id)`.** The schema default fills the `id` column at insert time — fine when nothing in the flow needs the value beforehand, as in Notes' `create` (the id is only read back from `.returning()`). Generate it explicitly with `fx.id()`, and pass it into `.values({ id, … })` yourself, whenever the flow needs the same id *before or alongside* the insert — to reference it in an emitted signal payload, to use it as a foreign key in a second insert in the same flow, or to return it without a round-trip. Linkly's `shorten` is the pattern: `const id = fx.id()` because the row and any signal about it need to agree on the same identifier within one flow body.

## Element checklist across the four applications

| Element | First appears | The unification it proves |
|---|---|---|
| **Flow** | Basic | endpoint = consumer = cron = CDC = workflow — one species |
| **Store** | Basic | sql · kv · files · index; cache and replica routing derived from effects |
| **Signal** | Intermediate | queue = pub/sub = stream; delivery is a property, not three ecosystems |
| **Clock** | Intermediate | cron = delay = durable time |
| **Gate** | Intermediate | auth = ABAC = rate limit, composable at the trigger |
| **Vault** | Advanced | typed contracts, boot-time validation, per-flow read capability |
| **Channel** | Advanced | email = sms = whatsapp = push; consent, locale and fallback built in |
| **AI** | Complex | prompts versioned · agents bounded by your own flows · cost and PII enforced by the compiler |
| **`fx` door** | Basic | journaling · tests · least privilege · transactions · tenancy · i18n · cost |
| **Manifest** | Basic | client · docs · console · security · bundle · infrastructure |
| **Plugin** | Advanced | extends through the same law; built-ins have no private API |

**Ten exports — `on, flow, signal, store, clock, gate, vault, channel, ai, plugin` — one law.**

That is the harmony.
