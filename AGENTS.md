# OKE — Agent Contract

This file is for coding agents. Read it before changing OKE apps or this
repo. Specs live in `docs/spec/`. **If the spec is silent, stop and ask.**

## How to use OKE

**Mental model:** every backend behavior is a Flow. All world access goes
through `fx`. New infrastructure is a **driver** on an existing element —
never a ninth element.

### Canonical Flow

Same species for HTTP, cron, and signal consumers — only the trigger changes:

```typescript
import { on, flow, http, every } from "okengine";

export const create = on(
  http.post("/pings").gate(fair),
  flow({
    name: "main.create",
    in: NewPing,
    out: PingId,
    do: async (input, fx) => {
      const [row] = await fx.store(db).insert(pings).values(input).returning();
      await fx.emit(pinged, { id: row.id, note: row.note, at: Date.now() });
      return { id: row.id };
    },
  }),
);

on(pinged, flow({
  name: "main.onPinged",
  do: async ({ id, note }, fx) => {
    await fx.send(pingNotice, { to: "dev@localhost", data: { id, note } });
  },
}));

on(every("1h"), flow({
  name: "main.prune",
  do: (_input, fx) => fx.store(db).delete(pings).where(/* … */),
}));
```

- **Trigger** — `http.*`, `every(...)`, or a signal — always `on(Trigger, flow)`
- **Contracts** — `in` / `out` / `errors` (Standard Schema)
- **Body** — `do(input, fx)` only. No raw `fetch`, `node:fs`, or vendor SDKs

### `fx` surface

| Call | Element |
|---|---|
| `fx.store(db)` | Store |
| `fx.emit(signal, payload)` | Signal |
| `fx.vault(secret)` | Vault |
| `fx.send(template, opts)` | Channel |
| `fx.ask(prompt, input)` | AI |
| `fx.call(flow, input)` | Flow (untriggered / named) |
| `fx.fail("ErrorName", data)` | typed error result |
| `fx.clock.now()` / `fx.clock.sleep(label, duration)` | Clock |

Effects are inferred from what the Flow touches through `fx`.

### App wiring

```typescript
import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "my-app" }).adopt({ main });

Object.assign(app.$options, {
  gates: [fair],
  secrets: [appSecret],
  signals: [pinged],
  stores: [db],
  channel: { templates: [pingNotice], defaultLocale: "en" },
});
```

### App file layout

```text
oke.config.ts          # drivers + images
src/app.ts             # oke().adopt + register elements
src/schema.ts          # tables
src/core.ts            # store handle (db)
src/flows/<unit>/
  index.ts             # on(…) + flow({…})
  shapes.ts            # contracts
  signals.ts           # signal declarations
src/gates.ts · vault.ts · channels.ts
```

### Config rule

- `drivers` — protocols by mode (`postgres`, `redis`, `s3`, `smtp`, …)
- `images` — vendor choice for Docker (`postgres:18-alpine`, …)
- Never name a driver after a vendor (`neon`, `minio`, …)

**Deploy:** `prod` protocols live in `oke.config.ts`; connection values
(`DATABASE_URL`, `REDIS_URL`, vault secret names) come from `process.env` on
the host. Staging is a second copy with different env values — not a
`staging` driver key. Handbook: Get Started → Deploy. Generate artefacts with
`oke docker --prod`; process entry is `oke start`.

## The one law

Every backend behavior is a Flow:

```text
on(Trigger) → Effects
```

There are no separate species called endpoints, handlers, consumers, jobs,
subscribers, or workflows. There is one species — the **Flow** — and triggers
are typed values.

## The eight elements

| Element | Essence |
|---|---|
| **Flow** | behavior |
| **Signal** | data in motion |
| **Store** | data at rest (`sql` · `kv` · `files` · `index`) |
| **Clock** | time |
| **Gate** | permission to act |
| **Vault** | protected knowledge |
| **Channel** | reaching humans |
| **AI** | reaching machine intelligence |

An element earns its place only if it has irreducible physics. New
infrastructure becomes a new **driver** for an existing element — never a
ninth element.

## The ten exports

```typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
```

That is the entire public vocabulary. Everything else is derived.

## Governing rule

> **Adopt, don't reinvent; bind natively; name drivers after protocols.**

- Never rebuild software that already exists at high quality.
- Bind through the runtime's native clients (`Bun.sql`, `bun:sqlite`,
  `Bun.redis`, `Bun.S3`, …) — not reimplementations, not npm client wrappers
  when a native client exists.
- Name drivers after **protocols / standards**, not vendors (`postgres`,
  `redis`, `s3` — never `neon`, `dragonfly`, `minio` as driver ids). Vendor
  choice lives in `images`, keyed by role.

We build only what genuinely does not exist: the effect system, the Manifest
and its derivations, the Console, the AoT compiler, the plugin engine, and
thin adapters from eight elements to real software.

## The fx rule

**All world access goes through `fx`. No exceptions.**

A direct `node:` import (or any other side-channel I/O) in element or flow
code is a **defect**. `fx` is the single door to the outside world; effects
are inferred from what a Flow touches through it. Deterministic tests, least
privilege, cache invalidation, live queries, and durability all depend on
this invariant.

## Ports

| Port | Surface |
|---|---|
| **6530** | App |
| **6533** | Console |
| **6535** | MCP |

Mnemonic: O·K·E = 6·5·3.

## Budgets

| Budget | Limit |
|---|---|
| Kernel (edge profile) | < 15 kB |
| Client runtime | < 3 kB |
| Cold start on Bun | < 75 ms |
| p99 routing overhead | < 1 ms |

A regression fails the build. Claims we cannot measure, we do not make.

## Package shape

Published packages:

- `okengine` — framework. Subpath exports: `.`, `./client`, `./test`,
  `./config`, `./auth`, `./drivers/*`. `"sideEffects": false`. CLI: `oke`.
- `create-oke` — scaffold (`bunx create-oke@latest <name>`). Lives in
  `packages/create-oke`; clean starters are `templates/*`, teaching apps stay
  in `examples/*` (`--from-example`).

Engine: Bun `>=1.3`.

## Do / Don't

| Don't | Do |
|---|---|
| I/O outside `fx` (`fetch`, `node:fs`, vendor SDKs in flow bodies) | `fx.store` / `fx.emit` / `fx.send` / `fx.vault` / `fx.ask` |
| Invent endpoints, jobs, or handlers beside Flows | `on(trigger, flow({…}))` |
| Add a ninth “element” | New **driver** on an existing element |
| Driver id = vendor (`neon`, `minio`) | Protocol id + vendor in `images` |
| Guess behavior the spec does not define | Stop and ask |

## Where to copy from

| Need | Open |
|---|---|
| Smallest live shape | `templates/hello` |
| Recommended layout | `templates/standard` |
| CRUD + schema contracts | `examples/notes` |
| Full application | `examples/skyport` |
| Design authority | `docs/spec/unified-theory.md` |
| Console | `docs/spec/console.md` |
| Worked teaching apps | `docs/spec/four-applications.md` |

## Spec authority

| Spec | Path | Open when |
|---|---|---|
| Unified theory | `docs/spec/unified-theory.md` | laws, elements, effects, AI contract |
| Four applications | `docs/spec/four-applications.md` | end-to-end app patterns |
| Console | `docs/spec/console.md` | Console UI / server behavior |

**If the spec is silent, stop and ask.**

## Framework repo notes

For changes inside this monorepo (not a scaffolded app):

| Path | Role |
|---|---|
| `src/kernel` | Flow runtime, boot, router, `fx` |
| `src/elements` | Eight elements |
| `src/drivers` | Protocol adapters |
| `src/cli` | `oke` CLI |
| `src/console` | Console server + UI |
| `src/compiler` · `manifest` · `mcp` · `docker` · `auth` · `client` | derived surfaces |
| `templates/*` | clean starters for `create-oke` |
| `examples/*` | teaching apps (`--from-example`) |
| `packages/create-oke` | scaffold CLI |
| `docs/spec/*` | authoritative specs |
| `site/` | handbook (partly generated) |

Verify:

```bash
bun run typecheck
bun test
bun run gate
bun run bench          # when touching budgets / cold start / bundle size
bun run budgets
bun run ci             # before large changes
```
