# okengine

**Package:** `okengine` · **CLI:** `oke` · **License:** MIT

Every backend behavior is a Flow: `on(Trigger) → Effects`. There are no separate species called "endpoints", "handlers", "consumers", "jobs", "subscribers", or "workflows". There is one species — the **Flow** — and triggers are typed values. Everything a backend has ever needed reduces to eight typed elements; an element earns its place only if it has irreducible physics. The entire public vocabulary is ten exports — `on`, `flow`, `signal`, `store`, `clock`, `gate`, `vault`, `channel`, `ai`, `plugin` — and everything else is derived. MIT-licensed.

```typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
```

## Quick start

```bash
bun add okengine
```

### `examples/notes/src/app.ts`

```typescript
import { oke } from "okengine";
import * as notes from "./flows/notes";

export const app = oke({ name: "notes" }).adopt({ notes });

export type App = typeof app;   // ← the client needs nothing else
```

### `examples/notes/src/flows/notes/index.ts`

```typescript
export const create = on(http.post("/notes"), flow({
  in: NewNote,
  out: NoteId,
  do: async (input, fx) => {
    const [note] = await fx.store(db).insert(notes).values(input).returning();
    return { id: note.id };
  },
}));
```

```bash
oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535
```

App on `:6530`, Console on `:6533`, MCP on `:6535`.

Full Notes tree: [`examples/notes`](examples/notes).

## Learning path

Read the four apps in order — each adds the smallest next set of ideas ([`docs/spec/four-applications.md`](docs/spec/four-applications.md)):

| App | New ideas | Path |
|---|---|---|
| **Notes** | `oke`, `on`, `flow`, `http`, `store.sql`, `fx`, typed errors, the typed client. | [`examples/notes`](examples/notes) |
| **Linkly** | `signal` and its three delivery physics · `clock` · `gate` · triggers beyond HTTP · transactional emit · cross-unit decoupling. | [`examples/linkly`](examples/linkly) |
| **Provisions** | `durable` flows and the journal · `vault` · `channel` with fallback chains and i18n · live queries · plugins · a CDC trigger · the three cache tiers. | [`examples/provisions`](examples/provisions) |
| **Skyport** | the `ai` element (models, prompts, RAG, agents) · multi-tenancy · SLOs and journeys · distributed topology · the three scaling axes. | [`examples/skyport`](examples/skyport) |

## The eight elements

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Flow** | endpoint · handler · consumer · job · workflow · webhook | behavior |
| **Signal** | queue · pub/sub · stream · websocket · SSE · event bus | data in motion |
| **Store** | database · cache · KV · file storage · search index | data at rest (`sql` · `kv` · `files` · `index`) |
| **Clock** | cron · delay · timeout · durable sleep · TTL | time |
| **Gate** | auth · session · ABAC · rate limit · quota · feature flag | permission to act |
| **Vault** | secrets · config · environment | protected knowledge |
| **Channel** | email · SMS · WhatsApp · push | reaching humans |
| **AI** | model calls · prompts · embeddings · agents · RAG | reaching machine intelligence |

## The Console

Seventeen panels at `:6533` (app `:6530`, MCP `:6535`): **Overview · Flows · Signals · Store · Clock · Gates · Vault · Channels · AI · Architecture · Traces · Runs · Manifest Diff · Access · Plugins**, plus **Privacy** and **Tenancy** when their optional core plugins are plugged.

Operator and user planes are never merged; every Console action is a real flow through `fx`, so the audit log is the trace. Detail: [`docs/spec/console.md`](docs/spec/console.md).

## CLI

```bash
bun add okengine                 # ONE package

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535
                                 #   → also auto-syncs client types on every save
oke dev --stack                  # -s  also boot the real infra stack (generated compose)
oke dev -s store.sql,signal      #     partial: only these roles get real backends

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke stack                        # preview resolved images/tags/ports — writes nothing

oke schema generate              # core + plugin tables → schema/oke.ts   (--check in CI)
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # Dockerfile + compose.store.sql.yml · compose.store.kv.yml · …
oke docker --prod                # healthchecks, volumes, limits, secret refs, deploy.replicas
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```

## Plugins

`.plug()` attaches a plugin; scope is the attachment point — `app.plug()` is app-wide, `unit.plug()` covers one unit, `flow.plug()` covers one flow. The position is the scope; there is no `global: true` and no inheritance rule to remember — see [unified theory §14](docs/spec/unified-theory.md#14-plugins--the-extensibility-law) for anyone writing one.

## Security

The Console is treated as internet-facing even when bound to localhost — Host header validation, Origin validation, and authentication are mandatory across `:6530`, `:6533`, and `:6535` ([console.md §10](docs/spec/console.md#10-security-posture)). Security is enforced at every layer: Host/Origin validation even on localhost, two-plane auth (operator vs user), and capability-scoped tokens.

## Status and contributing

Pre-1.0. MIT. No `CONTRIBUTING` yet — issues and PRs are welcome.

Specs: [`docs/spec/unified-theory.md`](docs/spec/unified-theory.md) · [`docs/spec/four-applications.md`](docs/spec/four-applications.md) · [`docs/spec/console.md`](docs/spec/console.md).
