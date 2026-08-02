<p align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://shieldcn.dev/header/grid.svg?title=okengine&subtitle=One+law.+Eight+elements.+Ten+exports.&logo=https://raw.githubusercontent.com/omqkhafi/okengine/main/site/public/logo/OKE-W.svg&theme=zinc&size=banner&mode=dark&font=geist&align=left"
    />
    <img
      alt="okengine — One law. Eight elements. Ten exports."
      src="https://shieldcn.dev/header/grid.svg?title=okengine&subtitle=One+law.+Eight+elements.+Ten+exports.&logo=https://raw.githubusercontent.com/omqkhafi/okengine/main/site/public/logo/OKE-B.svg&theme=zinc&size=banner&mode=light&font=geist&align=left"
      width="750"
    />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/okengine"><img alt="npm" src="https://shieldcn.dev/npm/okengine.svg?size=sm&variant=outline" /></a>
  <a href="https://jsr.io/@omqkhafi/okengine"><img alt="JSR" src="https://shieldcn.dev/jsr/@omqkhafi/okengine.svg?size=sm&variant=outline" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="MIT" src="https://shieldcn.dev/npm/license/okengine.svg?size=sm&variant=outline" /></a>
  <a href="https://bun.sh"><img alt="Bun >=1.3" src="https://shieldcn.dev/badge/Bun-%3E%3D1.3.svg?logo=bun&size=sm&variant=outline" /></a>
  <a href="https://github.com/omqkhafi/okengine/actions"><img alt="CI" src="https://shieldcn.dev/github/ci/omqkhafi/okengine.svg?size=sm&variant=outline" /></a>
  <a href="https://github.com/omqkhafi/okengine/commits"><img alt="last commit" src="https://shieldcn.dev/github/last-commit/omqkhafi/okengine.svg?size=sm&variant=outline" /></a>
</p>

<p align="center">
  <em>Stop gluing APIs, jobs, and queues into one backend. One law collapses them — client, Console, and infra come free. Yours to host.</em>
</p>

<p align="center">
  <a href="https://oke.omqkhafi.dev"><strong>Docs</strong></a> ·
  <a href="https://oke.omqkhafi.dev/docs"><strong>Handbook</strong></a> ·
  <code>oke</code> CLI ·
  <a href="https://www.npmjs.com/package/create-oke"><code>create-oke</code></a>
</p>

> [!WARNING]
> **Early development (`v0.x`) — not production-ready.**
>
> APIs, drivers, and tooling can change quickly, including **breaking changes**, until an initial stable release. Use for exploration and feedback — **not** production workloads yet.

## Install

```bash
bun add okengine                                   # framework + `oke` CLI
bunx jsr add @omqkhafi/okengine                    # JSR — library API only
bunx create-oke@latest my-app                      # scaffold
```

## Quick start

```bash
bunx create-oke@latest my-app
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
