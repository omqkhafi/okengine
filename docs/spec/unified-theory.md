# OKE — The Unified Theory of Backend

**Package:** `okengine` · **CLI:** `oke` · **License:** MIT · **Status:** design closed, ready for implementation

> One law. Eight elements. Ten exports. One package. One manifest.
> Every backend need is **derived**, never added.

---

# Part I — The Idea

## 1. The problem with every framework that came before

Hono, Elysia, Encore, iii, NestJS, Nitro — and everything before them — share one hidden flaw: **they are collections of separate inventions bundled behind a single logo.** A router, plus a queue library, plus a cron library, plus a websocket layer, plus a tracing integration. The concepts don't derive from one another; they merely ship together.

That is why frameworks bloat, why their documentation sprawls into dozens of unrelated pages, and why none of them survives a decade intact. Each new infrastructure fashion adds a *concept*, and concepts never get removed.

## 2. The move

Stop adding concepts. **Find the smallest set of laws from which everything else follows** — the way physics reduced a thousand phenomena to a few equations.

If the laws are right, the framework stays complete for a hundred years regardless of how infrastructure changes, because new technology becomes a **driver**, never a **new concept**.

## 3. Positioning

> **OKE is the batteries-included TypeScript backend for the Bun era:** contract-first APIs with end-to-end type safety, declarative infrastructure primitives, an OpenTelemetry-native Console, secure-by-default auth and ABAC — pure TypeScript, Web-Standards portable, MIT-licensed, self-hostable with zero cloud lock-in.

*"Encore's batteries and dashboard, Elysia's speed and DX, Hono's portability — without the Rust lock-in, the cloud gravity, or the source-available license."*

| | Hono | Elysia | Encore.ts | iii | **OKE** |
|---|---|---|---|---|---|
| Primary runtime | Multi (Web Std) | Bun-first | Node + Rust core | Rust engine, polyglot | **Bun-first, Web-Std portable** |
| License | MIT | MIT | MPL-2.0 | ELv2 engine | **MIT** |
| Typed client | hc RPC | Eden Treaty | generated | SDK | **contract-first + live queries** |
| DB · queue · cron · storage | ❌ | ❌ | ✅ | ✅ | **✅ (7 elements)** |
| Durable workflows | ❌ | ❌ | ❌ | partial | **✅ (a flag)** |
| Local Console | ❌ | ❌ | ✅ | ✅ | **✅ (dev + prod)** |
| Auto cache invalidation | ❌ | ❌ | ❌ | ❌ | **✅ (from effects)** |
| Least-privilege by compiler | ❌ | ❌ | ❌ | ❌ | **✅** |
| Human channels (email/SMS/WA) | ❌ | ❌ | ❌ | ❌ | **✅ (7th element)** |
| AI in the application (models, prompts, agents) | ❌ | ❌ | ❌ | ❌ | **✅ (8th element)** |
| Self-host, no lock-in | ✅ | ✅ | ✅ (Cloud optional) | ⚠️ | **✅ first-class** |

---

# Part II — The Laws

## 4. The One Law

> **Every backend behavior is a Flow: `on(Trigger) → Effects`.**

There are no separate species called "endpoints", "handlers", "consumers", "jobs", "subscribers", or "workflows". There is one species — the **Flow** — and triggers are typed values:

```typescript
on(http.post("/bookings"), createBooking);      // "an API endpoint"
on(every("10m"), expireStale);                  // "a cron job"
on(orderPlaced, sendReceipt);                   // "a queue consumer"
on(db.table(users).changed("email"), reverify); // "a CDC trigger"
```

One law → one mental model → one documentation page → one hook pipeline → one trace shape → one thing for an AI agent to learn.

**Learning OKE is learning one sentence.**

## 5. The Eight Elements

Everything a backend has ever needed reduces to eight typed elements. An element earns its place **only if it has irreducible physics.** New infrastructure becomes a new driver for an existing element — never a ninth element.

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

### Why queue, pub/sub, and stream collapse into one Signal

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

### Why Channel is an element and not a library

Reaching a human has physics that machine messaging does not: localized templates, consent and opt-out, delivery receipts and bounces, and fallback chains across mediums. A Signal cannot express any of it. Hence the seventh element — and no eighth.

### Why AI is an element and not a library

Apply the same test — does it have physics no existing element expresses?

| What an AI-powered backend needs | Covered by an existing element? |
|---|---|
| streaming tokens to the client | ✅ `Signal` with `delivery: "live"` |
| an agent loop with steps | ✅ `Flow` with `durable: true` |
| vector search for RAG | ✅ `Store` facet `index` |
| provider fallback chains | ✅ same pattern as `Channel` |
| **non-determinism** (same input ≠ same output) | ❌ breaks caching, testing, and replay |
| **cost as a first-class dimension** | ❌ no element has a concept of price per call |
| **prompts as versioned, evaluated artifacts** | ❌ neither a template nor a schema |
| **egress privacy boundaries** to third parties | ❌ Gates guard entry, not exit |
| **testing a non-deterministic output** | ❌ entirely different test physics |

Five properties are irreducible, so AI earns the eighth slot.

**On the tension with our own rule.** "New technology is a driver, not a concept" still holds — Anthropic → Bedrock → a 2030 provider are all drivers. But probabilistic inference is not new *infrastructure*; it is a new *category of interaction*. The symmetry is exact: **Channel reaches humans, AI reaches machine intelligence.** Neither can be expressed by Store or Signal.

## 6. Ten exports

```typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
```

That is the entire vocabulary. Everything else in this document is derived from it.

---

# Part III — The Engine

## 7. The Effect System — where the magic compounds

Every Flow's **effects are part of its type**, inferred by the compiler from what it touches through `fx` — the single door to the outside world.

```typescript
const createBooking = flow({
  in: CreateBooking, out: BookingId, errors: { FlightFull },
  do: async (input, fx) => {
    const left = await fx.store(db).countAvailable(input.flightId);
    if (left < input.seats) return fx.fail("FlightFull", { seatsLeft: left });
    const id = fx.id();
    await fx.store(db).insert(bookings).values({ id, ...input });
    await fx.emit(orderPlaced, { orderId: id });
    return { id };
  },
});
// inferred → effects: { reads: [sql:bookings], writes: [sql:bookings], emits: [order-placed] }
```

Because effects are known statically, the following are **derived with zero extra code** — no framework has combined them before:

| # | Capability | How it falls out |
|---|---|---|
| 1 | **Automatic cache invalidation** | The compiler knows which writes touch the same keys a read used. Invalidation is *computed*, never hand-written. |
| 2 | **Live queries** | Mark a read `.live()`; clients re-render on exactly the writes that affect it. Realtime stops being a separate system. |
| 3 | **Durability as a flag** | `durable: true` journals every effect call; `fx.clock.sleep("7d")` survives deploys. Workflows are ordinary Flows with one option. |
| 4 | **Least privilege by construction** | Each Flow receives a capability token for only its declared effects. A compromised handler cannot touch what it never declared. |
| 5 | **Provably true architecture diagrams** | Edges *are* the declared effects. "What breaks if I change this table?" becomes a compiler query. |
| 6 | **Deterministic tests** | `fx` is the only door — swap it wholesale: memory drivers, frozen clock, recorded effects, golden effect-stream diffs. |
| 7 | **Semantic tree-shaking** | The manifest lists exactly which elements and drivers are used; the build emits only those. |
| 8 | **Transactional messaging** | `fx.emit()` enrolls in the same transaction as `fx.store()` writes — the dual-write bug is eliminated by default. |
| 9 | **Automatic replica routing** | Read-only flows route to read replicas without annotations. |
| 10 | **Time as a dimension** | Journaled effects enable `oke branch prod --at "yesterday"` and replay of a single flow against fixed code. |
| 11 | **Compile-time AI data governance** | Fields tagged `pii` cannot reach a third-party model: the build **fails** unless the flow masks them or declares `allowPii` explicitly. |
| 12 | **Provably bounded agents** | An agent's tools are your own flows, carrying their own gates and capabilities — so an agent physically cannot exceed what the code declares. Safety by structure, not by trusting the model. |
| 13 | **Cost as a visible effect** | The compiler knows which paths call a model, enabling per-flow and per-tenant budgets, cost per endpoint in the Console, and a Manifest Diff that warns *before* deploy: "this release adds ~$0.02 per request." |

Any one of these would headline a framework launch. All ten follow from one decision: **effects live in the types.**

## 8. The Manifest — the 100-year artifact

Code dies. Frameworks die. **Data formats survive** — SQL is from 1974, HTTP from 1991. So OKE's true product is not the runtime; it is the **Manifest**: a versioned, runtime-neutral, machine-readable description of your entire system, extracted from your TypeScript at build time.

```
your code ──compile──▶ manifest.oke.json ──▶ everything else is DERIVED
                        │
                        ├─ typed client (+ live queries)
                        ├─ OpenAPI + AsyncAPI + documentation
                        ├─ architecture diagram (provably accurate — it IS the system)
                        ├─ Console panels, traces, explorers
                        ├─ MCP surface for AI agents
                        ├─ least-privilege capability matrix
                        ├─ cache invalidation keys
                        ├─ replica read-routing plan
                        ├─ Dockerfile + per-role compose files
                        ├─ tree-shaken bundle contents
                        └─ test harness wiring
```

The Manifest schema is a small formal spec, versioned independently of the runtime (`"oke": "1.0"`). **A runtime that does not exist yet can read a 2026 manifest and serve the system.** That is the honest meaning of "built for a hundred years": the description outlives every implementation.

---

# Part IV — Governance

## 9. Adopt, don't reinvent — but bind natively

> **We never rebuild software that already exists at high quality. We bind to it through the runtime's native clients, and we name our drivers after protocols, not vendors.**

Two things get called "native." We mean the first, never the second:

| ✅ Native = runtime clients (what we do) | ❌ Native = our own reimplementation (what we don't) |
|---|---|
| `Bun.sql` · `bun:sqlite` · `Bun.redis` · `Bun.S3` · `Bun.password` · `node:crypto` | writing our own cache server, broker, object store, or secrets manager |
| zero npm client dependencies, maximum speed, one runtime API | duplicated effort, worse quality, a decade of other people's bugs to re-fix |

**We build only what genuinely does not exist:** the effect system, the Manifest and its derivations, the Console, the AoT compiler, the plugin engine, and the thin adapters connecting eight elements to real software.

**Everything else is adopted:** Postgres · Redis/Valkey · NATS · S3-compatible storage · SOPS/age · OpenBao · Infisical · SMTP · OpenTelemetry · Drizzle.

## 10. Drivers are named after protocols; images after vendors

Welding a vendor name into the architecture is a design bug. `kv: "dragonfly"` is wrong; `kv: "redis"` is right — it is a protocol, and Valkey, Dragonfly, KeyDB, and Upstash all speak it.

| Element | Driver (protocol / standard) | Any of these work, unchanged |
|---|---|---|
| `store.sql` | `sqlite` · `postgres` | Postgres · Neon · Supabase · RDS · Timescale · pgvector |
| `store.kv` | `memory` · `redis` | Redis · Valkey · Dragonfly · KeyDB · Upstash |
| `store.files` | `fs` · `s3` | AWS S3 · R2 · MinIO · SeaweedFS · RustFS · Garage · Backblaze |
| `signal` | `memory` · `postgres` · `redis` · `nats` · `kafka` | the matching servers, any vendor |
| `clock` | `memory` · `postgres` | — |
| `vault` | `env` · `sops` · `openbao` · `infisical` · managed | — |
| `channel.*` | `smtp` · `resend` · `ses` · `unifonic` · `twilio` · `wa-cloud` · `fcm` | any SMTP server |
| `store.index` | `pgvector` · `qdrant` · `meilisearch` · `typesense` | vector + full-text search for RAG |
| `ai` | `mock` · `anthropic` · `openai-compatible` · `bedrock` · `vertex` · `ollama` | `openai-compatible` covers vLLM, Groq, Together, LM Studio, and most self-hosted servers |

Vendor choice lives in `images`, keyed by **role**:

```typescript
images: { "store.sql": "pgvector/pgvector:pg17", "store.kv": "valkey/valkey:8-alpine" }
```

## 11. Always latest — in three tiers

| Tier | Rule | Why |
|---|---|---|
| **Our own toolchain** | latest always (TypeScript 7, Bun, oxc) | greenfield, no legacy; speed is part of the promise |
| **What we require of users** | conservative floor + day-one support for new majors | a framework demanding bleeding edge loses adoption |
| **Adopted infrastructure** | latest **stable**, pinned by digest | `latest` tags destroy reproducibility |

**Toolchain decision with teeth:** TypeScript 7 went GA on 8 July 2026 (Go-native, 8–12× faster builds) but ships **without a stable programmatic API until 7.1**. Therefore the Manifest extractor **never uses the TypeScript compiler API** — it uses **oxc** (Rust parser). We gain independence from TypeScript's release cycle, higher speed, and zero exposure to that gap. `tsc` is used for type-checking only.

---

# Part V — Architecture

## 12. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ App = oke() + plugins   (services, auth, panels — all plugins)│
├──────────────────────────────────────────────────────────────┤
│ Hooks: onRequest → onParse → onAuth → beforeHandle →          │
│        handler → afterHandle → onError → onResponse           │
├──────────────────────────────────────────────────────────────┤
│ Eight elements, reached only through `fx`                     │
├──────────────────────────────────────────────────────────────┤
│ Drivers (protocol-named) → real software                      │
├──────────────────────────────────────────────────────────────┤
│ Runtime adapters: Bun (primary) · Node · Edge (Web Standards) │
├──────────────────────────────────────────────────────────────┤
│ Observability: OpenTelemetry, always on                       │
└──────────────────────────────────────────────────────────────┘
              ▲ Manifest → client · Console · docs · infra · MCP
```

## 13. Core design decisions

| Layer | Decision |
|---|---|
| **Runtime** | Bun-first via `Bun.serve`; Web-Standards adapters for Node/Deno/Edge; target WinterTC Minimum Common Web API |
| **Router** | compiled RegExp matching with a Trie fallback (Hono's SmartRouter idea), linear preset for cold-start edge |
| **Validation** | Standard Schema — bring Zod 4, Valibot, ArkType, TypeBox |
| **AoT compiler** | Sucrose-style static analysis generates a minimal per-route parse/validate handler; **`aot: false` dynamic fallback** for `eval`-restricted runtimes |
| **Context** | per-request `fx` object with typed composition (`derive`/`decorate`); no decorator DI |
| **Infrastructure** | driver model (Nitro/unstorage-style): dev = memory/sqlite/fs ⇄ prod = real software |
| **Contracts** | schema in / schema out / typed errors → end-to-end types, OpenAPI, AsyncAPI, typed client |
| **Auth** | built-in flagship (hybrid JWT + revocable refresh, ABAC, MFA); provider seam for better-auth, Clerk, Supabase, Auth0, Kinde |
| **AI** | MCP server exposing catalog, schemas, effects, traces, and safe runtime actions |

## 14. Plugins — the extensibility law

A plugin is a function that receives the app, adds capabilities, and returns it **with accumulated types.** A plugin may contribute: flows, hooks, context decorations, elements, drivers, image recipes, DB schema, typed errors, client extensions, CLI commands, and Console panels.

> **Guarantee:** every built-in feature — auth, Console, docker derivation, channels — uses only the public plugin API. If the core team ever needs a private hook, the API is broken and gets fixed.

## 15. The Console (`:6533`)

Reads truth from the Manifest + OpenTelemetry. Runs in **development and production** (production behind authentication).

| Panel | Answers |
|---|---|
| **Catalog** | what exists — every flow, trigger, gate, schema, effect |
| **Architecture** | how it connects — a diagram that *is* the code |
| **API Explorer** | typed request forms; impersonate any scope set |
| **Traces** | one OTel trace across http → store → signal → durable steps |
| **Store** | DB explorer, files browser, replica lag, computed cache keys |
| **Signals** | queue depth, in-flight, DLQ contents, live-feed monitors |
| **Clock** | upcoming crons, sleeping durable flows ("wakes in 6d 22h") |
| **Gates** | permission matrix, rate-limit counters, MFA enforcement |
| **Channels** | outbound messages, delivery receipts, bounces, opt-outs |
| **Manifest Diff** | blast radius of a deploy: new effects, widened permissions |

**The constitutional rule:** the Console **reads truth and writes only through git.** Runtime actions (replay a DLQ message, trigger a cron, wake a durable flow) execute directly. Structural changes (add an index, raise retries) are emitted as **reviewable diffs into your working tree** — you approve, git records. Every element deep-links to the exact line in Cursor.

---

# Part VI — Defaults

## 16. The default table

| Area | Default | Alternatives | Rationale |
|---|---|---|---|
| Runtime | Bun | Node · Deno · Edge | speed, native clients |
| Language | TypeScript 7, ESM only, strict | — | no CJS, no compromise |
| Manifest parser | oxc | SWC | independent of the TS release cycle |
| Validation | Standard Schema (Zod 4 in templates) | Valibot (edge) · ArkType · TypeBox | familiarity; AoT neutralizes runtime differences |
| ORM | Drizzle (peer dependency) | adapters later | never bundled, always yours |
| `store.sql` | dev `sqlite` · prod `postgres` | Neon · Supabase · RDS | `Bun.sql`, `bun:sqlite` |
| `store.kv` | dev `memory` · prod `redis` | Valkey · Dragonfly · KeyDB | protocol, not vendor |
| `store.files` | dev `fs` · prod `s3` | SeaweedFS · RustFS (beta) · MinIO · R2 | `Bun.S3` |
| `signal` | dev `memory` · prod **`postgres`** | `redis` · `nats` · `kafka` (explicit) | transactional with your data |
| `clock` | `postgres` | — | durability needs transactional storage |
| `vault` | dev `.env.local` · prod `sops`/age | OpenBao · Infisical · managed | existing standard, no invented format |
| `channel.email` | dev `console` · prod `smtp` | Resend · SES | no vendor lock-in |
| `delivery` | **none — must be declared** | — | semantic decision, never guessed |
| `store.index` | `pgvector` | Qdrant · Meilisearch · Typesense | RAG without another service |
| `ai` | dev `mock` · prod **none — must be declared** | Anthropic · openai-compatible · Bedrock · Vertex · Ollama | model choice is never guessed; `mock` keeps dev deterministic |
| AI + `pii` | **denied** | explicit `allowPii` | egress governance enforced at build time |
| AI caching | off (semantic cache opt-in) | — | non-deterministic output must not be silently reused |
| Auth | built-in, hybrid session, argon2id | better-auth · Clerk · Supabase · Auth0 · Kinde | works with zero config |
| Topology | `monolith` | `services` | start simple |
| Tenancy | off | row · schema · database | no complexity without need |
| Cache | automatic for live/read flows only | flag · manual | no surprises |
| Rate limit | `sliding-window-counter` | fixed-window · sliding-log · token-bucket · leaky-bucket | best accuracy/cost balance |
| i18n | `en` (configurable) | any locale | global default, user overrides |
| Errors | `{ data, error }` values | — | errors are values |
| Telemetry | on; dev 100%, prod 10% + all errors | any ratio | observability without cost |
| Migrations | manual in production | auto in dev | never touches your data |
| Console | dev on · prod on **behind auth** | off | it is your eyes in production |
| Ports | 6530 app · 6533 Console · 6535 MCP | configurable | O·K·E = 6·5·3 |
| License | MIT | — | no BSL/SSPL |

## 17. Why `signal` defaults to Postgres

Not performance — **correctness.** The dual-write bug is the most common distributed-systems mistake: you write the booking, then publish the message; a crash in between loses the message, or a rollback after publishing sends mail about a booking that does not exist.

With Postgres, `fx.emit()` runs **inside the same transaction** as `fx.store()`, and the effect system wires it automatically. Redis and NATS cannot offer this — the standard remedy is an outbox table, which lives in Postgres anyway.

When you explicitly choose `redis` or `nats` for throughput, the driver keeps the outbox relay internally, so semantics do not regress. Upgrading is a pure performance decision.

| | Postgres | Redis Streams | NATS JetStream |
|---|---|---|---|
| Throughput | ~1k–10k/s | 100k+/s | millions/s |
| **Transactional with your data** | **yes** | no | no |
| Extra service | no | yes | yes |
| Fan-out / live | weak | excellent | excellent |
| DLQ inspection | plain SQL | tooling | tooling |

---

# Part VII — Scale, Safety, Longevity

## 18. Three scaling axes (never conflated)

| Axis | Question | Mechanism |
|---|---|---|
| **Split** (`topology`) | one deployable, or one per unit? | `monolith` = in-process calls · `services` = one container per unit, `fx.call` becomes network — code unchanged |
| **Clone** (horizontal) | how many copies of the app? | run N instances: `once` signals deliver to exactly one, crons leader-elect, live queries fan out. `oke docker --prod` emits `deploy.replicas` |
| **Data replicas** | how many copies of the data? | `replicas:` on the driver; read-only flows auto-route (derived from effects) |

## 19. Multi-tenancy as a dimension of `fx`

```typescript
oke({ tenancy: { resolve: (ctx) => ctx.auth.orgId, isolation: "row" } })  // row | schema | database
```

Because every store call passes through `fx`, tenant scoping applies automatically — no forgotten `WHERE org_id`. Rate limits, caches, secrets, and channel branding become per-tenant for free. **`oke doctor` fails the build** if any flow reads a tenant-scoped table without a tenant in context. Cross-tenant leaks become structurally hard.

## 20. Compliance derived (PDPL / GDPR)

Tag fields once in the schema (`pii`, `sensitive`, `retain: "7y"`). From the effect graph OKE derives: automatic redaction in logs and traces, retention jobs as clock flows, `oke privacy export --subject <id>` and `oke privacy erase --subject <id>` assembled across every store touching that subject, and a per-release data-flow report for auditors.

Compliance becomes a property of the code, not an annual project.

## 21. Errors that carry a fix

```
OKE1042  Flow "bookings.create" emits signal "order-placed" with no subscriber.
         → Add `on(orderPlaced, …)` or mark the signal `{ optional: true }`.
         https://oke.dev/e/1042
```

Stable, permanent, searchable codes with a cause, a suggested fix, and a docs link. The Console links each code to the exact line.

## 22. The stability contract

- Manifest spec versioned independently (`"oke": "1.0"`)
- Semver on the runtime; **codemods ship with every breaking change** (`oke upgrade` rewrites your code and prints a diff)
- One LTS line supported for three years
- Flows declare `since` / `deprecated`; the client warns; the Console shows real usage per deprecated flow, so APIs retire on evidence

## 23. Adoption on-ramps

```typescript
mount(honoApp)   //  existing app runs inside OKE, untouched
mount(elysiaApp) //  new work uses flows; old routes keep serving; one deployable
mount(expressApp)
```
Plus `oke import express|hono|elysia` codemods for the mechanical parts. Migration becomes incremental — the only kind that actually happens.

## 24. Budgets enforced in CI, published per release

| Budget | Limit |
|---|---|
| Kernel (edge profile) | < 15 kB |
| Client runtime | < 3 kB |
| Cold start on Bun | < 75 ms in CI (GitHub Actions runners are less predictable than a dev machine); measured ~25–30 ms on real hardware |
| p99 routing overhead | < 1 ms |

A regression fails OKE's own build. Claims we cannot measure, we do not make.

## 25. The AI contract

`AGENTS.md` + MCP (`:6535`) expose the Manifest, schemas, effects, traces, and the Console's safe runtime actions. Because capabilities are least-privilege and structural edits arrive as reviewable diffs, an agent can operate the system **without the ability to exceed what the code declares**.

OKE is the first backend an AI can fully read, safely operate, and provably not break.

**Two directions, one design.** §25 covers AI *for the developer* (agents operating your system through MCP). The AI element (§5) covers AI *inside the application* (models, prompts, agents your users trigger). Both rest on the same foundation — declared effects and least-privilege capabilities — which is why an agent in either direction is bounded by construction rather than by policy.

---

# Part VIII — Execution

## 26. Roadmap

| Phase | Contents |
|---|---|
| **MVP (0.1–0.4)** | Bun adapter · router · Standard Schema + AoT (with dynamic fallback) · `fx` and the effect system · `on`/`flow` · typed errors · typed client · OTel baseline · plugin engine · `create-oke` |
| **v1 (0.5–1.0)** | all eight elements + drivers · Manifest + derivations · Console · auth + ABAC · schema generation · docker/compose derivation · durability · live queries · i18n · MCP · Node + Edge adapters |
| **Ecosystem (1.x)** | more drivers and image recipes · `mount()` adapters and import codemods · tenancy · privacy tooling · `@oke/react` · community plugin registry |

## 27. Package structure (one published package)

```
okengine/                     # ONE npm package, subpath exports, "sideEffects": false
├── src/
│   ├── kernel/               # on · flow · fx · effect system · hooks · router
│   ├── elements/             # signal · store · clock · gate · vault · channel · ai
│   ├── drivers/              # protocol-named, tree-shaken by manifest
│   ├── compiler/             # oxc-based manifest extraction · AoT · semantic shaking
│   ├── runtime/              # bun · node · edge adapters
│   ├── auth/                 # built-in + provider seam
│   ├── client/               # typed client (+ live)
│   ├── console/              # dev/prod UI (Vite + React)
│   ├── docker/               # image recipes, compose derivation
│   ├── mcp/                  # AI surface
│   ├── test/                 # createTestApp harness
│   └── cli/                  # oke
└── examples/skyport/         # the reference application
```

## 28. Risks, honestly

| Risk | Mitigation |
|---|---|
| `eval`-based AoT blocked on some edge runtimes | first-class `aot: false` dynamic mode; AoT is a Bun/Node optimization, not a requirement |
| TypeScript inference depth at scale | budget inference performance work early; codegen fallback for very large apps |
| Scope is enormous for a small team | driver model keeps each element small; adopt rather than build; sequence ruthlessly |
| Raw throughput below Encore's Rust runtime | accepted — compete on DX, portability, license, batteries, and derived capabilities |
| Ecosystem cold start | `mount()` interop so Hono/Elysia middleware remains usable from day one |
| Auto cache invalidation edge cases | raw SQL requires explicit effect annotation, otherwise that flow opts out of auto-caching; correctness never silently breaks |

---

## 29. Why this survives a hundred years

1. **Laws, not features.** Eight elements cover the *categories* of backend need. The future changes drivers, never elements.
2. **The Manifest outlives runtimes.** A versioned, runtime-neutral description; the kernel compiles to WASM for hosts that do not exist yet.
3. **Effects-in-types is a ratchet.** Every future capability derives from the same static knowledge instead of adding API surface.
4. **One package, one law, ten exports** — small enough to be *finished*. Finished software can be maintained for a century; sprawling software cannot.
5. **Adopt, don't reinvent.** We inherit the longevity of Postgres, Redis, S3, SOPS, and OpenTelemetry instead of competing with it.
6. **MIT, self-host first, drivers as the community surface.** No company's death can kill it.

---

**One law · eight elements · ten exports · one package · one manifest.**
*Adopt what exists. Build only what doesn't. Name things after standards.*
