---
title: "Signal"
description: "data in motion — Queues, pub/sub, and streams collapse into one Signal. Delivery physics (`once` · `broadcast` · `live`) is mandatory — no silent default."
source: "docs/spec/unified-theory.md"
---

Signal is the element for **data in motion**.

Queues, pub/sub, and streams collapse into one Signal. Delivery physics (`once` · `broadcast` · `live`) is mandatory — no silent default.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Signal** | queue · pub/sub · stream · websocket · SSE · event bus | data in motion |

## Why this is an element

#### Why queue, pub/sub, and stream collapse into one Signal

They were always the same object with different **delivery physics**. So delivery becomes an option, not three ecosystems:

```typescript
export const orderPlaced = signal("order-placed", {
  schema: z.object({ orderId: z.string() }),
  delivery: "once",        // "once"      → queue semantics: competing consumers, retries, DLQ
                           // "broadcast" → pub/sub semantics: fan-out to every subscriber
                           // "live"      → stream semantics: client-subscribable, replayable
  retries: 5, deadLetter: true,
});
```

`delivery` is **mandatory with no default.** Delivery physics is a semantic decision; guessing it produces silent, expensive bugs.

## Example from the teaching apps

Claimed fence from **linkly** — same source the doc-drift gate checks:

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

## Next

- [Store](/docs/elements/store)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
