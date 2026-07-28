---
title: "Notes"
description: "Basic — the one law, contracts, typed errors, the client."
source: "docs/spec/four-applications.md"
---

> **Basic — the one law, contracts, typed errors, the client.**
>
> Scaffold: `bunx create-oke@latest my-notes --from-example notes` then `oke dev` (app `:6530`, Console `:6533`).

## 1 · BASIC — Notes

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

### `examples/notes/oke.config.ts`

```typescript
import { defineConfig } from "okengine/config";

export default defineConfig({
  drivers: {
    store: {
      sql: {
        local: "sqlite",
        docker: "postgres",
        test: "memory",
        prod: "postgres",
      },
    },
  },
});
```

That is the whole configuration. Drivers are named after **protocols**, so `postgres` covers Postgres, Neon, Supabase and RDS alike.

### `examples/notes/src/schema.ts`

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

### `examples/notes/src/core.ts`

```typescript
import { store } from "okengine";
import * as schema from "./schema";

export const db = store.sql("notes", { schema });
```

### `examples/notes/src/flows/notes/index.ts`

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

### `examples/notes/src/app.ts`

```typescript
import { oke } from "okengine";
import * as notes from "./flows/notes";

export const app = oke({ name: "notes" }).adopt({ notes });

export type App = typeof app;   // ← the client needs nothing else
```

`on()` still registers each flow with the router and the Manifest — `.adopt()` exists so the type of `app` accumulates every contract in `notes`, which is what lets the client below need no hand-written types and no separate codegen step. The namespace key (`notes`) becomes the client's namespace; each export becomes a method.

#### The client

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

### `examples/notes/tests/notes.test.ts`

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

#### Run it

```bash
bun add okengine
oke dev          # app :6530 · Console :6533 · MCP :6535
bun test
```

Open `:6533` and the Console already shows the four flows, their contracts, their effects, and a live architecture diagram — derived, not configured.

#### What you have

Four exports (`oke`, `on`, `flow`, `store`), two elements, a typed client, automatic caching, and a Console.

#### What is missing

Everything here is synchronous. A real application needs work that happens *later* — after the response, on a schedule, or in reaction to something. That is the next app.

---
---
