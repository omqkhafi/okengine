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
  id: text("id").primaryKey().$defaultFn(id),
  title: text("title").notNull(),
  body: text("body").notNull(),
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
import { on, http, store } from "okengine";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { db } from "../../core";
import { notes as notesTable } from "../../schema";

// Contracts derived from the schema — one source of truth.
const NewNote = createInsertSchema(notesTable, { title: (s) => s.min(1).max(120) }).omit({
  id: true,
  createdAt: true,
});
const Note = createSelectSchema(notesTable);

// One declarative resource: list (cursor + search + filters + order +
// select), create (201), get / update / remove with typed NotFound.
const notesR = store.resource(db, notesTable, {
  in: NewNote,
  out: Note,
  update: NewNote.partial(),
  list: {
    cursor: [notesTable.createdAt, notesTable.id],
    direction: "desc",
    limit: 20,
    maxLimit: 100,
    search: [notesTable.title],
    filter: "all",
    order: "all",
  },
  unit: "notes",
  breaking: true,
});

// Mount all five verbs: list/create on /notes, get/update/remove on /notes/:id.
// `on(http.resource(...))` returns the ops bag; spread it into named exports
// so `adopt({ notes })` registers each flow under the unit.
const mounted = on(http.resource("/notes", notesR.all()));

export const list = mounted.list;
export const create = mounted.create;
export const get = mounted.get;
export const update = mounted.update;
export const remove = mounted.remove;
```

**Four things to notice.**

`fx` is the only door to the outside world. `store.resource` expands into five ordinary `flow({…})`s whose bodies compose `fx.store(db)` — which is what lets the framework know that `create` writes `notes` and `list` reads it, with no annotation from you.

**One resource, five flows.** `store.resource(db, table, opts)` returns the unbound `FlowDef`s (`list` / `create` / `get` / `update` / `remove`); `on(http.resource(path, resource.all()))` mounts all five verbs and hands back the ops bag for `adopt`. The generated flows are still the one species — `store.resource` is sugar over `flow` + `fx`, never new physics.

**The list URL is the whole query.** `?cursor=` / `?offset=` / `?limit=` paginate (keyset over `cursor` columns, else offset), `?search=` (alias `?q=`) runs a substring match over the `search` columns, `?col=op.value` filters (PostgREST ops: `eq ne gt gte lt lte like ilike in is`), `?order=col.desc` orders, and `?select=id,title` projects. Every surface is whitelisted by a ColumnScope (`"all" | Column[] | "none"`), and values are UTF-8 — English, Arabic, any language round-trips.

**Contracts are derived, errors are values.** `drizzle-zod` turns the table into request and response schemas. `list` answers the Stripe envelope `{ data, meta: { nextCursor, hasNextPage }, error: null }`; `create` answers 201, `remove` 204; `get` / `update` / `remove` return a typed `NotFound` via `fx.fail`. There is no `throw` and no hand-rolled cursor codec.

### `examples/notes/src/app.ts`

```typescript
import { oke } from "okengine";
import * as notes from "./flows/notes";

export const app = oke({ name: "notes" }).adopt({ notes });

export type App = typeof app; // ← the client needs nothing else
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
else console.log(data.title); // ← typed, no codegen ✅
// GET /notes/n_1 — the method and path are derived from the flow's own trigger,
// not from a separate RPC convention.
```

### `examples/notes/tests/notes.test.ts`

```typescript
import { afterEach, expect, test } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

// `app.boot` is idempotent, so each test re-boots fresh memory drivers only
// after the previous boot is stopped.
afterEach(async () => {
  await app.stop();
});

test("create returns 201 body then read", async () => {
  const t = await createTestApp(app); // memory driver, automatic
  const { data, error } = await t.api.notes.create({ title: "First", body: "Hello" });
  expect(error).toBeNull();
  expect(data!.title).toBe("First");

  const { data: note } = await t.api.notes.get({ id: data!.id });
  expect(note!.title).toBe("First");
});

test("list: cursor pages over the Stripe envelope (data + meta)", async () => {
  const t = await createTestApp(app);
  for (const title of ["alpha", "bravo", "charlie", "delta", "echo"]) {
    const { error } = await t.api.notes.create({ title, body: `body of ${title}` });
    expect(error).toBeNull();
  }

  // Success envelope is flat: { data: Note[], meta: { nextCursor, hasNextPage }, error: null }.
  const page1 = await t.api.notes.list({ limit: 2 });
  expect(page1.error).toBeNull();
  expect(page1.data).toHaveLength(2);
  expect(page1.meta!.hasNextPage).toBe(true);
  expect(typeof page1.meta!.nextCursor).toBe("string");

  const page2 = await t.api.notes.list({ limit: 2, cursor: page1.meta!.nextCursor });
  expect(page2.error).toBeNull();
  expect(page2.data).toHaveLength(2);
  expect(page2.meta!.hasNextPage).toBe(true);

  const page3 = await t.api.notes.list({ limit: 2, cursor: page2.meta!.nextCursor });
  expect(page3.error).toBeNull();
  expect(page3.data).toHaveLength(1);
  expect(page3.meta!.hasNextPage).toBe(false);
  expect(page3.meta!.nextCursor).toBeNull();

  // Keyset order: createdAt DESC, id DESC — pages never overlap or skip rows.
  const all = [...page1.data, ...page2.data, ...page3.data];
  expect(new Set(all.map((n) => n.id)).size).toBe(5);
  for (let i = 1; i < all.length; i++) {
    expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
  }
});
```

#### Run it

```bash
bun add okengine
oke dev          # app :6530 · Console :6533 · MCP :6535
bun test
```

Open `:6533` and the Console already shows the five flows, their contracts, their effects, and a live architecture diagram — derived, not configured.

#### What you have

Four exports (`oke`, `on`, `flow`, `store`), two elements, a typed client, automatic caching, and a Console.

#### What is missing

Everything here is synchronous. A real application needs work that happens _later_ — after the response, on a schedule, or in reaction to something. That is the next app.

---

---
