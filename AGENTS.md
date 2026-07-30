# OKE — Agent Contract

This file is loaded by every later session. It prevents drift. Product documentation lives in `site/content/docs/`. **If the documentation is silent, stop and ask.**

## The one law

Every backend behavior is a Flow:

```text
on(Trigger) → Effects
```

There are no separate species called endpoints, handlers, consumers, jobs, subscribers, or workflows. There is one species — the **Flow** — and triggers are typed values.

## The eight elements

| Element     | Essence                                         |
| ----------- | ----------------------------------------------- |
| **Flow**    | behavior                                        |
| **Signal**  | data in motion                                  |
| **Store**   | data at rest (`sql` · `kv` · `files` · `index`) |
| **Clock**   | time                                            |
| **Gate**    | permission to act                               |
| **Vault**   | protected knowledge                             |
| **Channel** | reaching humans                                 |
| **AI**      | reaching machine intelligence                   |

An element earns its place only if it has irreducible physics. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## The ten exports

```typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
```

That is the entire public vocabulary. Everything else is derived.

## Governing rule

> **Adopt, don't reinvent; bind natively; name drivers after protocols.**

- Never rebuild software that already exists at high quality.
- Bind through the runtime's native clients (`Bun.sql`, `bun:sqlite`, `Bun.redis`, `Bun.S3`, …) — not reimplementations, not npm client wrappers when a native client exists.
- Name drivers after **protocols / standards**, not vendors (`postgres`, `redis`, `s3` — never `neon`, `dragonfly`, `minio` as driver ids). Vendor choice lives in `images`, keyed by role.

We build only what genuinely does not exist: the effect system, the Manifest and its derivations, the Console, the AoT compiler, the plugin engine, and thin adapters from eight elements to real software.

## The fx rule

**All world access goes through `fx`. No exceptions.**

A direct `node:` import (or any other side-channel I/O) in element or flow code is a **defect**. `fx` is the single door to the outside world; effects are inferred from what a Flow touches through it. Deterministic tests, least privilege, cache invalidation, live queries, and durability all depend on this invariant.

## Ports

| Port     | Surface              |
| -------- | -------------------- |
| **6530** | App                  |
| **6533** | Console              |
| **6535** | MCP                  |
| **6536** | Docs MCP (read-only) |

Mnemonic: O·K·E = 6·5·3.

## Budgets

| Budget                | Limit   |
| --------------------- | ------- |
| Kernel (edge profile) | < 15 kB |
| Client runtime        | < 3 kB  |
| Cold start on Bun     | < 75 ms |
| p99 routing overhead  | < 1 ms  |

A regression fails the build. Claims we cannot measure, we do not make.

## Package shape

Published packages:

- `okengine` — framework. Subpath exports: `.`, `./client`, `./test`, `./config`, `./auth`, `./plugins`, `./drivers/*`. `"sideEffects": false`. CLI binary: `oke`.
- `create-oke` — scaffold CLI (`bunx create-oke@latest <name>`). Lives in `packages/create-oke` and ships one standard starter from `packages/create-oke/template`.

Engine: Bun `>=1.3`.

## Documentation authority

| Surface  | Path                                 |
| -------- | ------------------------------------ |
| Theory   | `site/content/docs/elements/`        |
| Console  | `site/content/docs/console/`         |
| CLI      | `site/content/docs/reference/cli.md` |
| Manifest | `manifest.v1.schema.json`            |

**If the documentation is silent, stop and ask.**

## After every implementation

Before claiming work done: run [`.agents/skills/oke-ship`](.agents/skills/oke-ship/SKILL.md) — append notes to `changelog.md` under `## Unreleased` (never under a shipped `## v…` section), and update site docs via [`.agents/skills/oke-docs`](.agents/skills/oke-docs/SKILL.md) for any user-facing surface. Version bump is separate: `bun run bump` promotes Unreleased into the next `## vX.Y.Z`.
