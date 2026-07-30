<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="site/public/OKE-W.svg" />
    <img alt="OKE" src="site/public/OKE-B.svg" width="220" />
  </picture>
</p>

# okengine

_"Stop gluing APIs, jobs, and queues into one backend. One law collapses them — client, Console, and infra come free. Yours to host."_

[![npm](https://img.shields.io/npm/v/okengine.svg)](https://www.npmjs.com/package/okengine)
[![JSR](https://jsr.io/badges/@omqkhafi/okengine)](https://jsr.io/@omqkhafi/okengine)
[![npm](https://img.shields.io/npm/v/create-oke.svg)](https://www.npmjs.com/package/create-oke)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Bun >=1.3](https://img.shields.io/badge/Bun-%3E%3D1.3-black.svg)](https://bun.sh)

**Docs:** [oke.omqkhafi.dev](https://oke.omqkhafi.dev) · **Handbook:** [/docs](https://oke.omqkhafi.dev/docs) · **CLI:** `oke` · **Scaffold:** [`create-oke`](https://www.npmjs.com/package/create-oke)

> [!WARNING]
> **Early development (`v0.x`) — not production-ready.**
>
> APIs, drivers, and tooling can change quickly, including **breaking changes**, until an initial stable release. Use for exploration and feedback — **not** production workloads yet.

## Install

```bash
bun add okengine                                   # framework + `oke` CLI
bunx jsr add @omqkhafi/okengine                    # JSR — library API only
bunx create-oke@latest my-app --template hello     # scaffold
```

## Quick start

```bash
bunx create-oke@latest my-app --template hello
cd my-app
oke dev
# or: oke mode docker && oke dev   # compose infra · app on host Bun
```

| Port    | Surface                                     |
| ------- | ------------------------------------------- |
| `:6530` | App                                         |
| `:6533` | Console                                     |
| `:6535` | MCP (live Manifest)                         |
| `:6536` | Docs MCP (handbook search/fetch, read-only) |

Mnemonic: **O·K·E = 6·5·3**.

Every backend behavior is a Flow: `on(Trigger) → Effects`. World access goes through `fx`.

Store apps sync schema with `oke db push|generate|migrate` (local `oke dev`
auto-pushes). Prefer `store.schema.table` + `field.*` or keep a
hand-written Drizzle `schema.ts`.

### Resource Flow

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

Full walkthrough: [Basic usage](https://oke.omqkhafi.dev/docs/get-started/basic-usage).

## Documentation

Everything beyond this page lives in the site handbook:

| Resource      | Link                                                               |
| ------------- | ------------------------------------------------------------------ |
| Docs site     | [oke.omqkhafi.dev](https://oke.omqkhafi.dev)                       |
| Handbook      | [/docs](https://oke.omqkhafi.dev/docs)                             |
| Changelog     | [/changelog](https://oke.omqkhafi.dev/changelog)                   |
| Agents index  | [/llms.txt](https://oke.omqkhafi.dev/llms.txt)                     |
| CLI reference | [/docs/reference/cli](https://oke.omqkhafi.dev/docs/reference/cli) |
| Manifest      | [`manifest.v1.schema.json`](manifest.v1.schema.json)               |
| Budgets       | [`BUDGETS.md`](BUDGETS.md)                                         |
| Contributing  | [`CONTRIBUTING.md`](CONTRIBUTING.md)                               |

Pre-1.0. Published on [npm](https://www.npmjs.com/package/okengine) and [JSR](https://jsr.io/@omqkhafi/okengine). MIT.
