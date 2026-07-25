---
title: "Flow"
description: "behavior — Endpoints, jobs, consumers, and workflows are one species. You bind a typed trigger with `on`, declare contracts, and implement `do` through `fx`."
source: "docs/spec/unified-theory.md"
---

Flow is the element for **behavior**.

Endpoints, jobs, consumers, and workflows are one species. You bind a typed trigger with `on`, declare contracts, and implement `do` through `fx`.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Flow** | endpoint · handler · consumer · job · workflow · webhook | behavior |

## Example from the teaching apps

Claimed fence from **notes** — same source the doc-drift gate checks:

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

## Next

- [Signal](/docs/elements/signal)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
