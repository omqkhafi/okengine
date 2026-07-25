---
title: "Skyport"
description: "Complex — AI, tenancy, SLOs, distributed topology."
source: "docs/spec/four-applications.md"
---

> **Complex — AI, tenancy, SLOs, distributed topology.**
>
> Scaffold: `bunx create-oke@latest my-skyport --from-example skyport` then `oke dev` (app `:6530`, Console `:6533`).

## 4 · COMPLEX — Skyport

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

### `examples/skyport/src/flows/bookings/shapes.ts`

```typescript
import { z } from "zod";

export const NewBooking  = z.object({ flightId: z.string(), seats: z.number().min(1).max(9) });
export const BookingId   = z.object({ id: z.string() });
export const BookingRow  = z.object({ id: z.string(), status: z.string(), seats: z.number() });
export const FlightFull  = z.object({ seatsLeft: z.number() });
```

### `examples/skyport/src/flows/bookings/signals.ts`

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

### `examples/skyport/src/flows/bookings/index.ts`

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

### `examples/skyport/src/flows/support/index.ts`

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

#### Declaring what "working" means

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

#### Multi-tenancy as a dimension of `fx`

`tenancy: { resolve, isolation: "row" }` in the config is the whole of it. Every store call passes through `fx`, so tenant scoping applies automatically — there is no forgotten `WHERE org_id`. Rate limits, caches, secrets and channel branding become per-tenant for free, and **`oke doctor` fails the build** if any flow reads a tenant-scoped table without a tenant in context.

#### The three scaling axes, never conflated

| Axis | Question | Mechanism |
|---|---|---|
| **Split** (`topology`) | one deployable, or one per unit? | `monolith` = in-process calls · `services` = a container per unit, `fx.call` becomes network — code unchanged |
| **Clone** (horizontal) | how many copies of the app? | run N instances: `once` signals deliver to exactly one, crons leader-elect, live queries fan out. `oke docker --prod` emits `deploy.replicas` |
| **Data replicas** | how many copies of the data? | `replicas:` on the driver; read-only flows auto-route, derived from effects |

### `examples/skyport/src/app.ts`

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

#### What you have

All eight elements, all ten exports, and one law.

---
---
