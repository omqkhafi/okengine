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
  <a href="https://bun.sh"><img alt="Bun >=1.3.14" src="https://shieldcn.dev/badge/Bun-%3E%3D1.3.14.svg?logo=bun&size=sm&variant=outline" /></a>
  <a href="https://github.com/omqkhafi/okengine/actions"><img alt="CI" src="https://shieldcn.dev/github/ci/omqkhafi/okengine.svg?size=sm&variant=outline" /></a>
  <a href="https://github.com/omqkhafi/okengine/commits"><img alt="last commit" src="https://shieldcn.dev/github/last-commit/omqkhafi/okengine.svg?size=sm&variant=outline" /></a>
</p>

<p align="center">
  <em>Stop gluing APIs, jobs, and queues into one backend. One law collapses them — client, Console, and infra come free. Yours to host.</em>
</p>

<p align="center">
  <a href="https://oke.omqkhafi.dev"><strong>Docs</strong></a> ·
  <a href="https://oke.omqkhafi.dev/docs"><strong>Handbook</strong></a> ·
  <a href="https://oke.omqkhafi.dev/llms.txt"><code>llms.txt</code></a> ·
  <a href="https://www.npmjs.com/package/create-oke"><code>create-oke</code></a>
</p>

> [!WARNING]
> **Early development (`v0.x`) — not production-ready.**
>
> APIs, drivers, and tooling can change quickly, including **breaking changes**, until an initial stable release. Use for exploration and feedback — **not** production workloads yet.

## Install

Requires [Bun](https://bun.sh) `>=1.3.14`.

```bash
bunx create-oke@latest my-app                      # scaffold (recommended)
bun add okengine                                   # framework + `oke` CLI
bun install -g okengine                            # global `oke` on PATH
bunx jsr add @omqkhafi/okengine                    # JSR — library API only
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

The starter already exports a health Flow — change it and save; App and Console update from the same Manifest:

```typescript
import { on, flow, http, gate } from "okengine";
import { z } from "zod";

export const health = on(
  http.get("/health").gate(gate.public),
  flow({
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
```

Call it with a typed client (contracts inferred — no separate codegen):

```typescript
import { createClient } from "okengine/client";
import type { App } from "./app";

const api = createClient<App>("http://localhost:6530");
const { data, error } = await api.main.health({});
```

Full walkthrough: [Basic usage](https://oke.omqkhafi.dev/docs/get-started/basic-usage).

## One law

Every backend behavior is a Flow: `on(Trigger) → Effects`. Endpoints, jobs, consumers, and webhooks are the same species — only the trigger changes.

```typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
```

That is the entire public vocabulary. World access goes through `fx` — effects are inferred, so the Manifest can derive the typed client, Console, and MCP without a second source of truth.

| Element     | Essence                       |
| ----------- | ----------------------------- |
| **Flow**    | behavior                      |
| **Signal**  | data in motion                |
| **Store**   | data at rest                  |
| **Clock**   | time                          |
| **Gate**    | permission to act             |
| **Vault**   | protected knowledge           |
| **Channel** | reaching humans               |
| **AI**      | reaching machine intelligence |

Theory: [Introduction](https://oke.omqkhafi.dev/docs/get-started/introduction) · [Elements](https://oke.omqkhafi.dev/docs/elements) · [Why OKE](https://oke.omqkhafi.dev/docs/get-started/why).

## Next

| Want…                       | Go to                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| Scaffold details & modes    | [Installation](https://oke.omqkhafi.dev/docs/get-started/installation) |
| Declarative CRUD            | [`store.resource`](https://oke.omqkhafi.dev/docs/elements/store)       |
| Auth, rate limits, sessions | [Gate](https://oke.omqkhafi.dev/docs/elements/gate)                    |
| Queues & live events        | [Signal](https://oke.omqkhafi.dev/docs/elements/signal)                |
| Email / SMS / push          | [Channel](https://oke.omqkhafi.dev/docs/elements/channel)              |
| `oke` commands              | [CLI](https://oke.omqkhafi.dev/docs/reference/cli)                     |

Store apps sync schema with `oke db push|generate|migrate` (local `oke dev` auto-pushes). Prefer `store.schema.table` + `field.*`, or keep a hand-written Drizzle `schema.ts`.

## Documentation

| Resource     | Link                                                           |
| ------------ | -------------------------------------------------------------- |
| Docs site    | [oke.omqkhafi.dev](https://oke.omqkhafi.dev)                   |
| Get started  | [/docs/get-started](https://oke.omqkhafi.dev/docs/get-started) |
| Handbook     | [/docs](https://oke.omqkhafi.dev/docs)                         |
| Changelog    | [/changelog](https://oke.omqkhafi.dev/changelog)               |
| Agents index | [/llms.txt](https://oke.omqkhafi.dev/llms.txt)                 |
| Manifest     | [`manifest.v1.schema.json`](manifest.v1.schema.json)           |
| Budgets      | [`BUDGETS.md`](BUDGETS.md)                                     |
| Contributing | [`CONTRIBUTING.md`](CONTRIBUTING.md)                           |

## License

Pre-1.0. Published on [npm](https://www.npmjs.com/package/okengine) and [JSR](https://jsr.io/@omqkhafi/okengine). [MIT](https://opensource.org/licenses/MIT).
