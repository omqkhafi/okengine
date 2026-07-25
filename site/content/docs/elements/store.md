---
title: "Store"
description: "data at rest (sql · kv · files · index) — SQL, KV, files, and search index are facets of one Store surface. Drivers are named after protocols, not vendors."
source: "docs/spec/unified-theory.md"
---

Store is the element for **data at rest (sql · kv · files · index)**.

SQL, KV, files, and search index are facets of one Store surface. Drivers are named after protocols, not vendors.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Store** | database · cache · KV · file storage · search index | data at rest (`sql` · `kv` · `files` · `index`) |

## Example from the teaching apps

Claimed fence from **notes** — same source the doc-drift gate checks:

### `examples/notes/src/core.ts`

```typescript
import { store } from "okengine";
import * as schema from "./schema";

export const db = store.sql("notes", { schema });
```

## Next

- [Clock](/docs/elements/clock)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
