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

**Docs:** [okengine.vercel.app](https://okengine.vercel.app) · **Handbook:** [/docs](https://okengine.vercel.app/docs) · **CLI:** `oke` · **Scaffold:** [`create-oke`](https://www.npmjs.com/package/create-oke)

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
auto-pushes). Prefer `store.schema.table` + `field.*` (see Linkly) or keep a
hand-written Drizzle `schema.ts`.

### `examples/notes/src/flows/notes/index.ts`

```typescript
export const create = on(
  http.post("/notes"),
  flow({
    in: NewNote,
    out: NoteId,
    do: async (input, fx) => {
      const [note] = await fx.store(db).insert(notes).values(input).returning();
      return { id: note.id };
    },
  }),
);
```

Full walkthrough: [Basic usage](https://okengine.vercel.app/docs/get-started/basic-usage) · teaching apps: [Learn](https://okengine.vercel.app/docs/learn/notes).

## Documentation

Everything beyond this page lives on the site and in-repo specs:

| Resource          | Link                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Docs site         | [okengine.vercel.app](https://okengine.vercel.app)                                         |
| Handbook          | [/docs](https://okengine.vercel.app/docs)                                                  |
| Changelog         | [/changelog](https://okengine.vercel.app/changelog)                                        |
| Agents index      | [/llms.txt](https://okengine.vercel.app/llms.txt)                                          |
| Unified theory    | [`docs/spec/unified-theory.md`](docs/spec/unified-theory.md)                               |
| Four applications | [`docs/spec/four-applications.md`](docs/spec/four-applications.md)                         |
| Console           | [`docs/spec/console.md`](docs/spec/console.md)                                             |
| CLI reference     | [`docs/cli.md`](docs/cli.md) · [handbook](https://okengine.vercel.app/docs/cli)            |
| Budgets           | [`BUDGETS.md`](BUDGETS.md)                                                                 |
| Contributing      | [`CONTRIBUTING.md`](CONTRIBUTING.md) · [writing a driver](docs/guides/writing-a-driver.md) |

Pre-1.0. Published on [npm](https://www.npmjs.com/package/okengine) and [JSR](https://jsr.io/@omqkhafi/okengine). MIT.
