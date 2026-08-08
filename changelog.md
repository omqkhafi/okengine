# Changelog

Release history for `okengine`. One section per published tag, in reverse order.
This file is the canonical source: the site's `/changelog` page is derived from
it, so a release is only announced once it is written here.

Upcoming work lives under `## Unreleased`. `bun run bump` promotes that
section into `## v<version> — <YYYY-MM-DD>`. Every bullet belongs to an
`### ✨ Added` / `### ♻️ Changed` / `### 🐛 Fixed` group (also `### ⚠️ Deprecated` · `### 🔥 Removed` · `### 🔒 Security` when needed).

## Unreleased

## v0.10.3 — 2026-08-08

### ✨ Added

- `drivers.<element>[.<facet>]` config can now pin just the environment keys
  that differ from the real default, merged per-key instead of replacing the
  whole map — `{ store: { sql: { local: "pglite" } } }` resolves to `{
local: "pglite", docker: "postgres", test: "memory", prod: "postgres" }`,
  every other driver map (`kv`, `files`, `signal`, `clock`, `journal`,
  `vault`, `channel.email/sms`) staying fully at its real, untouched
  default. The real defaults now live in one place,
  `src/config/driver-defaults.ts`, and merge through a new
  `mergeEnvDriverMap` helper scoped strictly to the `{ local?, docker?,
test?, prod? }` shape (never a generic whole-config deep merge). Fixes a
  leak in `resolveDriverId`'s old `docker → prod → local → test` cascade,
  where pinning only `local` could bleed that value into `docker` / `prod`
  instead of falling back to the real default.
- `oke doctor` now prints the fully-resolved `drivers.*` config — every real
  default plus every override, for all four env keys at once — so the
  complete picture stays visible even when `oke.config.ts` only pins one
  key. New `--env local|docker|test|prod` flag picks which env's active
  driver id is highlighted (default: `docker` when `OKE_DOCKER=1`, else
  `local`); also included under a `drivers` key in `--json` output.
- `images` config is now nested the same way as `drivers` — `{ store: { sql,
kv, files, index }, channel: { email }, vault, ai, pgdog, proxy }` —
  instead of a flat `Record<string, string>` keyed by dotted role strings.
  Closes a real type-safety gap: the old shape accepted any string key with
  zero compile-time or boot-time catch (`"strore.sql"` silently did nothing).
  Internal compose/Dockerfile derivation is unchanged — a new
  `flattenImagesConfig()` in `okengine/config` flattens the nested shape back
  to the dotted-role map `deriveInfrastructure()` / `buildSpecs()` /
  credentials already worked with. `create-oke`'s scaffolder and both starter
  templates now generate the nested form; `oke ai setup` and the customize
  wizard's `images` codegen were rewritten to parse/emit it correctly
  (brace-balanced, not the old first-`}`-closes-it regex, which broke on
  nested sub-objects).

## v0.10.2 — 2026-08-07

### ✨ Added

- `store.sql` / `store.files`, `vault.secret`, `signal()`, and channel medium
  binders' `.template()` (`channel.email/sms/whatsapp/push().template()`) now
  register into a shared boot-time registry — `oke({...})` auto-populates
  `stores` / `secrets` / `signals` / `channel.templates` with zero explicit
  arrays, draining under the same `registry: "consume" | "keep" | "ignore"`
  switch that already governs `on()`'s trigger registry. Explicit arrays keep
  working unchanged — additive, deduped by reference, never silently ignored.
  `store.kv` / `store.index`, `vault.config`, and the medium-agnostic
  `channel.template()` are intentionally not auto-registered.
- `.adopt()` route wiring can now be generated instead of hand-listed: `oke
build` / `oke dev` regenerate `src/flows/generated.ts` from every
  `src/flows/<unit>/index.ts` folder (`export * as <unit> from
"./<unit>/index.ts"`), so `app.ts` becomes `import * as routes from
"./flows/generated"; oke({ name }).adopt(routes)`. A real file on disk, not
  a virtual module — a virtual-module Bun plugin was investigated and
  rejected: `Bun.plugin()`'s `onResolve` is never invoked for an
  unresolvable specifier during a plain runtime `import()`, so `oke dev` and
  `oke build` would have resolved it differently. Both templates ship a
  committed `src/flows/generated.ts` stub so a fresh clone type-checks before
  the first `oke dev` / `oke build` ever runs.

### 🔒 Security

- `docker` / `prod` boots now fail loud (`OKE1009`) when a `src/flows/<unit>`
  folder exists on disk but adopted zero flows — a stale or hand-edited
  `.adopt()` barrel, instead of a silently-incomplete route table. Opt-in via
  `rootDir` / `OKE_ROOT_DIR` (same gate as the `OKE1008` Manifest fallback);
  `local` / `test` warn once instead of failing, so the dev loop stays
  unbroken.

### ♻️ Changed

- `flow()` now takes its name as the first positional argument —
  `flow(name, options)` instead of `flow({ name, ...options })` — matching
  the name-first convention already used by `signal(name, options)` and
  `vault.secret(name, options?)` (pre-1.0; no compat shim, no dual-form
  overload).
- `flow()` no longer takes a `unit` option — `unit` is now derived from
  `name`'s first dot segment (`"auth.refresh"` → unit `"auth"`), matching
  every real call site, which always set both to the same value. Flows
  with no dot in their name have no unit, same as before.
- `create-oke`'s `advanced` / `standard` templates now scaffold `oke({ name:
"notes" })` with no explicit `stores` / `secrets` / `signals` /
  `channel.templates` arrays and no hand-written `.adopt({ main, notes })` —
  both come from the auto-registries and the generated route barrel above.
  Plugins are unaffected: `.plug()` stays fully explicit everywhere.

### 🐛 Fixed

- `oke dev`'s live keyboard controls dropped the `l` (list docker services)
  key and its whole `1`-`9` select-then-`u`/`x`/`r` per-service subsystem —
  `l` was the only way to discover which number mapped to which service, and
  the persistent status board above Logs already lists every service with a
  live status dot on every refresh, so the panel was a redundant duplicate.
  Refresh is now bound to `r` (was `c`) — freed up by dropping per-service
  restart, which was the only other thing bound to `r`.
- `oke ai setup` now also updates `docker/.env.docker` directly when it
  already exists. `OKE_AI_MODEL` is only ever seeded from `.env.local` into
  the docker stack on its _first_ boot (later values there are treated as
  durable, possibly hand-edited pins), so a second `oke ai setup` run —
  picking a different model after the stack already exists — previously
  wrote `.env.local` correctly but silently left the running docker profile
  on the old model forever.
- `oke dev --docker`'s llama.cpp entrypoint now passes an explicit
  `--ctx-size` (default `4096`, override via `OKE_AI_CTX_SIZE`) to
  `llama-server`. Left unset, `llama-server` defaults to the model's full
  native training context (32K-256K+ for many current models) and allocates
  the KV cache for that up front — often many times the model file's own
  size — OOM-killing the container on start regardless of how much memory
  Docker is given, even for small models.
- `bootApplication` no longer lets the ambient `OKE_DOCKER=1` process flag
  override an explicit `env` passed to `boot()` — only the `env`-unset
  default path now falls back to `docker`. Previously any sub-app that
  explicitly booted with `env: "local"` (e.g. the Console's own internal
  app under `oke dev -d`) got silently promoted to `docker`, tripping the
  `OKE1008` strict capability check on its own zero-effect flows.
- `extractManifest` now always records a flow's `effects` (including an
  empty `{}`), instead of omitting the key when a flow has no effects.
  Previously a pure, zero-effect flow (e.g. a template's `main.root`) was
  indistinguishable from "effects unknown," so `docker` / `prod` boots kept
  refusing an open capability token even after a correct manifest
  extraction confirmed there was nothing to declare.
- `oke db seed` now passes `rootDir` when booting the app entry, so
  `docker` / `prod` seeding can lazily derive a Manifest instead of
  hard-failing `OKE1008` on a fresh scaffold that hasn't run `oke build`
  yet.

## v0.10.1 — 2026-08-07

### ✨ Added

- Boot-time effects stamping: a flow with no hand-declared `effects` can now
  derive them from a compiled Manifest at boot — pass one explicitly
  (`oke({ manifest })`) or point `oke({ rootDir })` / `OKE_ROOT_DIR` at a
  source tree for a lazy `extractManifest` (never bundled into the edge
  graph — same `new URL(...)` trick as the element binders). `oke dev` /
  `oke start` set `OKE_ROOT_DIR` automatically; no template changes needed.

### 🔒 Security

- `docker` / `prod` boots now fail loud (`OKE1008`) when a flow has no
  declared effects and no Manifest to derive them from, instead of silently
  minting an open capability token (every access allowed, no gate at all).
  Previously true in every environment, for every flow that omitted
  `effects` — confirmed via real boot + `fetch()`, not assumption.
  `local` / `test` keep the open-token fallback (once-per-process `oke
boot:` warning) so the existing dev loop and test suite are unaffected.
- The SQL capability gate (`fx.store(db).insert(table)` / `.select().from(table)`
  / …) now resolves the exact table touched (`sql:<table>`) instead of only
  the store-level ref (`sql:<store-name>`) — matching the AoT compiler's own
  `sql:<table>` inference, which the boot-time stamping above now makes live
  for the first time. Backward compatible: a flow that still declares the
  older `effects: { writes: ["sql:<store-name>"] }` convention (every
  existing template) keeps working unchanged — the gate tries the precise
  table ref first, falls back to the store-level ref.

### 🐛 Fixed

- `oke dev` unit tests that inject `composeHealth` no longer shell out to a
  real `docker` binary for the session-long health watch — `composeHealthRun`
  is passed through to `startComposeHealthWatch` / `readComposeHealth`, and
  injecting `composeHealth` without a run stubs live `ps` polls.
- AoT effects inference: `fx.store(files).put(...)` / `.putImage(...)` are
  now recognized as writes and `.list(...)` as a read (were silently dropped
  from the inferred `effects`, files-store methods weren't in the
  read/write method sets).
- AoT effects inference: `fx.send(tpl, …)` now resolves through a local
  channel medium binder (`const mail = channel.email(...); mail.template(...)`),
  not just the literal `channel.template(...)` form — previously the send
  effect recorded the local variable name instead of the template id.
- AoT effects inference: a table argument now resolves through its
  `store.schema.table(name, …)` declaration instead of the raw JS
  identifier, so `const notesTable = store.schema.table("notes", …)` still
  infers `sql:notes` rather than the (wrong) `sql:notesTable`.

## v0.10.0 — 2026-08-07

### ✨ Added

- `oke dev -d` keyboard controls (TTY): `?` help · `c` refresh (clear logs +
  latest ●) · `q` quit · `l` list services · `u` up / `x` stop stack ·
  `1`–`9` then `u`/`x`/`r` for one service. Compose/AI status updates the
  board above Logs only — not a `redis stopped` / `starting` / `ready` spam.
  Elements and Docker are spaced; `l` / `?` refresh chrome first so the
  control panel is not interleaved with request logs.
- `oke dev -d` surfaces AI model state: hero + Docker summary show
  `OKE_AI_MODEL`, and a background poller prints phase changes
  (`waiting` / `starting` / `loading` / `ready` / `error`) for llama.cpp,
  vLLM, SGLang, and Ollama without blocking boot.
- `oke dev` hero elements and Docker rows show a colored status ● —
  green ready, yellow pending/loading, red error, dim idle (unbound).
  Docker colors come from `compose ps` health; AI uses model phase (not
  container healthy alone). Boot chrome prints immediately; compose / vault /
  health / AI work streams in an ephemeral progress pane that clears before
  the elements / Docker board. Compose health uses `ps -a` and keeps polling
  for the session so ● turns red when a container is stopped (Docker Desktop
  or crash); AI ● follows model phase while the AI container is up.
- `llama-cpp`, `vllm`, and `sglang` Docker image recipes for local / self-hosted
  inference — OpenAI-compatible endpoints, loopback-only host publish, pinned
  tags (never `latest`); docs decision matrix under Recipes → AI.
- `cockroach`, `yugabyte`, and `timescale` Docker image recipes for self-hosted
  `store.sql` (driver id stays `postgres`) — Cockroach on 26257 with
  `COCKROACH_*` + DB Console `:8080`, Yugabyte YSQL on 5433 with `YSQL_*`,
  Timescale with the same `POSTGRES_*` contract as Postgres; docs pages under
  Recipes → SQL.
- Docs **Recipes** pages for the five recipes that had zero coverage —
  Mailpit, Meilisearch, Ollama, OpenBao, RustFS — env names, volume paths,
  production notes, and real failure modes.
- create-oke templates ship `.github/workflows/ci.yml` (typecheck + `bun test`
  on push/PR), `tsconfig.json`, and a `typecheck` script — working CI on first
  push.
- `supabase` Docker image recipe — matches `supabase/postgres` ahead of the
  generic Postgres recipe (env + healthcheck + URL); Postgres-protocol and
  extension bundle only — not Auth / Storage / Realtime / Studio.
- Docs **Recipes** (`/docs/recipes`) — pin compose recipes already wired into
  `oke docker` (Postgres, PgDog, Supabase Postgres, Redis / Valkey /
  Dragonfly, Caddy, Traefik); vendor choice stays in `images[…]`.
- Docs **Providers** (`/docs/providers`) — managed SQL / Redis connection
  guides (Neon, Supabase, CockroachDB, YugabyteDB, Redis Cloud, ElastiCache,
  Memorystore, Azure Cache, Upstash, Dragonfly Cloud, DigitalOcean Caching);
  driver ids stay `postgres` / `redis`.
- Trace continuity — each execution allocates a stable run id (aligned with
  the durable journal when present); `fx.emit` stamps `parentRunId` on
  Signal messages; consumers and `fx.call` children record
  `WideEvent.parentId` so Console Traces join Flow → Signal → Flow chains.
- `oke replay --request-id <id>` — re-invoke a past Flow locally from a
  Runs WideEvent (defaults to dry-run when the ledger has `send`/`ask`).
- `WideEvent.input` — validated input snapshot persisted for replay
  (archived personal fields redacted to `[archived]`).
- `fx.runs` — capability-gated Runs read (`effects.reads: ["runs"]`) with
  `query` / `all` / `window` / `checkSlo` for native P95 + availability
  checkers over Clock + Channel (no `fx.metric`).
- Optional OTLP-shaped metric mapping (`wideEventToOtlpMetrics`) for teams
  with an existing observability stack — additive, never required.
- Console Runs — lookback window (`since`) + Error patterns table
  (error code counts in the selected window).
- Flow-level `compensate` on durable flows — runs after terminal failure
  under the same journal; undo work must use distinct `fx.step("undo:…")`
  names so completed forwards never re-run.
- Channel adversarial proofs — hard-bounce auto-suppression (transport never
  called on the next send), receipt ledger status progression, injectable
  suppression/consent/receipts escape hatch, Arabic `{{field}}` catalog
  round-trip, and WhatsApp template-vs-text characterization (24h session
  window documented as a Known gap — not enforced).
- `createSuppressionStore` re-exported from the `okengine` root (alongside
  consent / receipts) for the documented multi-instance injection recipe.

### ♻️ Changed

- Default local AI is **llama.cpp** (`ghcr.io/ggml-org/llama.cpp:server-b10290`,
  driver `openai-compatible`) — lightest footprint; create-oke Recommended and
  `oke ai setup --provider llama-cpp` follow. Ollama stays a fully supported
  alternative (`ollama/ollama:0.32.6`, never `latest`).
- `oke dev` request logs and ready line label the :6530 surface as **Backend**
  (was **App**); Console / MCP labels unchanged.
- `create-oke` customize: drop the **Enable store.index?** yes/no gate — walk
  `store.index` like other facets (`none` · memory · pgvector · libsql ·
  meilisearch; docker recommends meilisearch). **AI setup** is Recommended
  (llama.cpp defaults) · Customize · Off (replacing unclear Configure AI? Yes/No).
  Email menu labels `taqnyat-mail` as `taqnyat` (driver id unchanged). Install
  shows `bun install` progress instead of a silent spinner. Wizard labels drop
  decorative icons. `oke ai setup` / create-oke AI: llama.cpp · Ollama · vLLM ·
  SGLang · cloud; llama.cpp and Ollama share the banner → tier → recommended /
  manual shape (Docker Hub `ai/` catalog vs Ollama library + detect); llama.cpp
  catalog shows up to 20 curated `ai/` models per tier.
  **AI Provider — docker → Back** returns to the previous provider step.

- Ollama docker ensure: skip `/api/pull` when the container's `/api/tags`
  already lists the model (host `ollama` weights are a different server);
  stream pull progress instead of hanging on a silent `stream:false` body.
- Docs section path **Recipes** moves from `/docs/images` → `/docs/recipes`
  (folder, sidebar, and cross-links).
- Ollama recipe serves only; `oke dev -d` / `oke ai setup` pull
  `${OKE_AI_MODEL}` with `POST /api/pull` against the container's exposed
  `OKE_AI_URL` — never a host `ollama` CLI (which may hit a different local
  install).
- Recipes sidebar — Supabase recipe title drops “(Docker)”; Timescale, RustFS,
  Mailpit, OpenBao, Meilisearch, and Ollama use monochrome brand marks instead
  of Lucide placeholders.
- Docs **Recipes** + **Providers** rewritten to a concrete acceptance bar —
  exact env / dashboard click-paths, volume backup meaning, production
  hardening, and one real failure mode per page (no interchangeable prose).
- Docs sidebar — Recipes and Providers pages use monochrome brand marks
  (Postgres, Redis, Neon, Supabase, Caddy, Traefik, cloud vendors, PgDog paw
  from pgdog.dev, …) instead of generic Lucide placeholders.
- Homepage stack strip — Built with / Works with sit in a two-column grid
  under Stack; each column is a desktop marquee ticker (opposite directions,
  static wrap below `lg` / reduced motion); every listed name carries a
  brand mark.
- create-oke templates: fold `stores` into the initial `oke({ … })` call and
  drop the post-construction `Object.assign(app.$options, …)` block (including
  the leftover `env: "test"` pin). READMEs spell out scaffold vs what you
  still build.
- `SchemaColumnDecl` exposes a `getSQL()` type bridge so drizzle-orm operators
  (`eq`, `isNull`, …) typecheck against abstract schema columns — matching the
  documented `fx.store` query style.
- Overview SLO burn also evaluates Manifest `slo.latency.p95` (availability
  burn unchanged).
- Channel docs — suppression / hard bounce, shared-store injection,
  permanent-error no-failover, receipt statuses, Arabic catalog keys, and
  WhatsApp session/template Known gap.

### 🔒 Security

- Local AI recipes (llama.cpp + Ollama + vLLM + SGLang) publish inference ports
  on `127.0.0.1` only — never `0.0.0.0` — and pin patched floors (llama.cpp ≥
  b8146, Ollama ≥ 0.17.1). Docs require curated model sources (Docker Hub `ai/`,
  Ollama library); warn against arbitrary untrusted GGUF.

### 🔥 Removed

- create-oke package-level integration suite (`packages/create-oke/tests`) and
  the `CREATE_OKE_INTEGRATION` / `test:integration` gate — unit tests under
  `packages/create-oke/src` remain.

### 🐛 Fixed

- llama.cpp recipe no longer uses router `--models-preset` / bare
  `--docker-repo` (b10290+ leaves `/v1/models` stuck on `loading`). It emits
  `docker/llama-entrypoint.py` that Hub-pulls the curated model (native
  `llama download`, then CNCF `model.weight` fallback for tags like gemma4)
  and serves single-model with `-m` + `--alias`.
- `oke ai setup` / create-oke AI wizard write `OKE_AI_*` stack keys as
  **comments** in `.env.local` (same opt-in pattern as other infra) so they
  no longer shadow compose `OKE_AI_URL` from `docker/.env.docker`. Uncomment
  only for a host-managed AI endpoint; API tokens still write active.
- `docker/.env.docker` no longer duplicates `OKE_AI_URL` / `OKE_PGDOG_URL`
  (role aliases were re-emitting keys already written as `${prefix}_URL`).
- `oke dev` TTY matches create-oke Clack chrome: Docker summary sits under the
  hero, compose stdout is quiet, db/seed lines use `│` status rows, boot
  honesty prints once as a Notice box (Backend child suppressed), and seed in
  docker mode hydrates `DATABASE_URL` from `docker/.env.docker` so the prompt
  no longer fails with a garbled `%E2%80%A2` password redact.
- `oke dev --docker` restores parent `process.env` on session stop (compose
  URLs / `OKE_DOCKER` / driver overrides) so a stopped session cannot pollute
  later boots or the test suite.
- create-oke templates (and the framework pin) use exact `drizzle-orm` /
  `drizzle-kit` `1.0.0-rc.4` (npm `rc` tag) — caret `^1.0.0-rc.4` was
  resolving mismatched channel builds (`…-fb12281` / `…-ca0f029`).
- Local / monorepo create-oke no longer `file:`-links the workspace root —
  it stages a publish-shaped package under `~/.oke/create-oke/okengine`
  (production deps only). Linking the root installed Console
  `devDependencies` (including `drizzle-zod`), and Bun warned that RC
  `drizzle-orm` failed `drizzle-zod`’s `>=0.36` peer.
- Local create-oke stage **copies** `files` (not symlinks), folds peers into
  stage `dependencies`, and runs `bun install` in `~/.oke/create-oke/okengine`.
  Bun’s `file:` install drops directory symlinks and keeps `package.json`
  pointed at the stage, so without this `okengine/config` / `zod` resolution
  failed after scaffold.
- Ollama docker model download no longer depends on a host `ollama` CLI —
  boot/`oke ai setup` POST `/api/pull` to the container URL so a native host
  daemon cannot silently receive the weights.
- Durable execute path: thrown errors now commit the journal as `failed`
  (and record on Runs) instead of incorrectly marking `completed`.
- Channel email/SMS `FallbackTransport` now reuses `shouldFallbackOtpMedium`
  so permanent client errors (invalid address) do not advance the chain —
  matching OTP cross-medium failover (sently’s default only checked HTTP
  400/401/403 and SMTP auth).
- Docs Neon + Supabase Postgres recipe Accordion titles — quote `"vector"`
  with single-quoted attributes so MDX compiles (escaped `\"` broke the
  site build).

## v0.9.1 — 2026-08-04

### ♻️ Changed

- `otp()` option rename (pre-1.0, no compat shim): `tier: 1 | 2` →
  `mode: "provider" | "app"`. Plug-time / boot-time errors, plugin config
  snapshot, and docs use the new names. Docs also state that the two modes
  cannot both be active (same fixed `/auth/otp/*` routes — combine with a
  different plugin such as `magicLink()` instead), and clarify that
  `fx.sendOtp` / `fx.verifyOtp` are raw Channel capabilities (no `.plug()`)
  while `otp()` in provider mode is the full auth feature on top of them.

## v0.9.0 — 2026-08-04

### ✨ Added

- Redis-protocol `store.kv` image recipes — Redis (default), Valkey
  (`valkey/valkey`), and Dragonfly (`docker.dragonflydb.io/dragonflydb/dragonfly`).
  Driver id stays `redis`; pin via `images["store.kv"]`. Docs list each
  license in one line (RSAL/SSPL/AGPL · BSD-3 · BSL) and note that
  service-resale clauses only matter if you offer that datastore as a
  service — not for typical self-hosting.
- `compose.all.yml` — fully merged compose (layers 1–3) emitted alongside the
  existing per-role files; for Swarm `docker stack deploy -c compose.all.yml`
  and anyone who prefers one file. Layered `-f` order unchanged.
- PgDog as the default docker/prod SQL connection pooler — sits in front of
  Postgres (`images.pgdog`), transaction pooling, `DATABASE_URL` → `:6432`
  when both are pinned. Caps `N × pool` vs Postgres `max_connections` at the
  infrastructure layer (no in-process pool throttling). Read-replica routing
  (`BEGIN READ ONLY` → replica, failover on promotion) documented as
  readiness; not configured this round.
- `otp()` plugin — unified multi-channel OTP replacing `emailOtp()` /
  `phoneNumber()`. Explicit `tier: 1` (provider Verify via unchanged
  `fx.sendOtp`/`fx.verifyOtp`) or `tier: 2` (app-owned codes over declared
  `channels`: SMS / WhatsApp / email). Tier 2 adds channel-neutral resend
  (`POST /auth/otp/resend`, 60s cooldown), sealed OTP copy (HKDF
  `oke-otp-seal-v1` + AES-GCM, wiped with challenge TTL), and
  `fx.deliverOtp` (sently `FallbackTransport` cross-medium failover;
  Taqnyat WhatsApp `sendWithFailover` when bound).
- `taqnyat-whatsapp` Channel driver + `drivers.channel.whatsapp` boot bind
  (`wa-cloud` also wired).
- `GET /_/ready` — kernel readiness (`booting` → `orphan_scan` → `ready`)
  distinct from app `GET /health` liveness; `503` until the durable orphan
  scan finishes.
- `installGracefulShutdown` / `releaseInstanceLeases` — SIGTERM/SIGINT
  releases Clock + Journal leases held by this instance (reuses existing
  `releaseLease`), then drains the server. Wired on `oke dev`’s app runner.
- Kubernetes guidance — plain **Deployment** (never StatefulSet), probes,
  shared drivers, and honest multi-instance known limits
  (`site/content/docs/deployment/kubernetes.mdx`).
- Docker Swarm guidance — `docker stack deploy` on the generated compose
  layers; `compose.prod.yml` app `HEALTHCHECK` → `GET /_/ready`,
  `deploy.update_config` / `restart_policy`, `stop_grace_period: 30s`;
  `compose.yml` emits `app.image` for Swarm (ignores `build`)
  (`site/content/docs/deployment/docker-swarm.mdx`).
- Opt-in Docker proxy recipes — `images.proxy` with **Caddy** (automatic
  HTTPS via generated `Caddyfile`) or **Traefik** (Docker-label
  auto-discovery for `docker compose up --scale app=N`). Default remains
  no proxy (app publishes `6530`). Traefik mounts the Engine API only
  through `tecnativa/docker-socket-proxy` (never raw `docker.sock` on the
  edge). Docs: `site/content/docs/deployment/reverse-proxy.mdx`.
- Deployment docs section — `site/content/docs/deployment/` (compose vs
  Swarm vs Kubernetes decision hub + self-contained path pages for Docker /
  Swarm / Kubernetes: PgDog, SIGTERM, readiness, Signal/Channel honesty,
  reverse-proxy option in full on each).
- Horizontal multi-process integration test — two OS processes sharing live
  Postgres + Redis prove Clock-once, durable takeover, shared Gate rates,
  and mid-scenario SIGKILL absorption together (`OKE_TEST_POSTGRES_URL` +
  `OKE_TEST_REDIS_URL` / `REDIS_URL`; visible skip when unset).

### 🔥 Removed

- `emailOtp()` and `phoneNumber()` plugins — use `otp({ tier, … })` instead
  (pre-1.0; no compat shims).

### ♻️ Changed

- Deployment docs promoted to a top-level sidebar section
  (`site/content/docs/deployment/`) — peer of Elements / Console / Reference;
  Get Started is first-five-minutes only again.
- `sently` → `1.2.1` — Taqnyat Verify OTP live-verified end-to-end
  (`sendOtp` → handset code → `verifyOtp`); transport reads `Data.result`
  from live `returnJson` envelopes (fixes false `code 1` on success).
- Gate `drivers.store.kv: redis` without `REDIS_URL` / inject **fails loud**
  (no soft-fallback to memory that silently doubles rate budgets).
- Signal `redis` docs + boot warn: emit relays to Redis; consume / `live` /
  `drain` remain process-local outbox until Streams consume ships.
- Channel docs + boot warn: default suppression / consent / receipts are
  process-local until a durable driver ships (deferred epic — documented,
  not silent).
- Store `files: "fs"` boot warn — single-host; horizontal scale needs `s3`.

### 🐛 Fixed

- Session scopes / audience live on the session row (and Console SQLite
  hydrate/persist) — refresh no longer loses them across process restart
  via module-level Maps.
- App-plane sign-in rate limit relies on shared Gate KV only (removed the
  process-local email attempt bag that bypassed redis rates).

## v0.8.0 — 2026-08-04

### ✨ Added

- Postgres Clock CronStore (`drivers.clock: "postgres"`) — multi-host leader
  election via the same `FOR UPDATE SKIP LOCKED` + lazy lease reclaim pattern
  as Signal `once` delivery. Table `oke_crons` holds schedule rows with
  `locked_by` / `lease_expires_at`. Chaos-proven across OS processes against
  a real Postgres (`OKE_TEST_POSTGRES_URL`). `file` remains for local /
  single-host shared volumes.
- `defineSeed({ essential, dev, prod })` + `oke db seed` — explicit seed
  runs (never at boot). `essential` every env; `dev` on `local`/`docker`;
  `prod` on `prod` only. Docker/prod print the DB target and require typing
  the env name (`--force` skips). create-oke standard + advanced ship real
  `src/seed/` (welcome note + sample notes).
- `fx.store(db).upsert(table, matchOn, values, options?)` — insert when no
  match; existing rows untouched unless `{ onExisting: "update" }`.
- Store docs **Seeding** section (categories, upsert, confirm, migration
  boundary) and CLI reference for `oke db seed`.
- `<StoreSeeding />` teaching figure — env→block lighting + upsert outcomes
  under Store docs Seeding.
- Phone-number OTP delivery via Taqnyat Verify — `fx.sendOtp` / `fx.verifyOtp`
  on Channel; when `drivers.channel.sms` is `taqnyat`, `phoneNumber()` uses
  Taqnyat's provider-managed Verify API (no self-generated code). Non-Taqnyat
  SMS drivers fail loudly; no SMS driver keeps the local hashed path +
  `exposeDevOtp`.
- `taqnyat-mail` Channel email driver (additive) — magic-link and every
  `channel.email` template can deliver through Taqnyat Mail
  (`TAQNYAT_MAIL_TOKEN` + `TAQNYAT_CAMPAIGN`); SMTP/Mailpit stays the docker
  default.
- Opt-in Taqnyat live test suite — real `sendOtp` (success code `5`) and
  real Taqnyat Mail magic-link sends, double-gated behind the global
  per-medium flags `OKE_SMS_LIVE=1` / `OKE_EMAIL_LIVE=1` **plus** the real
  credentials; credential presence alone never sends. Skips are always
  visible.
- Postgres durable journal (`drivers.journal: "postgres"`) — durable-flow
  runs persist in `oke_journal_runs` with `locked_by` / `lease_expires_at`,
  reusing the Signal/Clock `FOR UPDATE SKIP LOCKED` + lazy lease reclaim
  pattern. `memory` (default) and `file` stay for local / single-host.
- Boot-time orphan discovery — a booted app scans the shared journal for
  `running` / due `sleeping` runs without a live lease and resumes them, no
  caller-supplied `runId`; the scheduler tick also claims due sleeps and
  sweeps expired-lease orphans from the shared store.
- Run-level lease coordination — every start / resume / wake acquires the
  run lease first (renewed on each journal persist, released on park /
  complete / fail), so two instances never execute the same run under a
  live lease; an in-process in-flight guard stops overlapping sessions
  (orphan scan vs. scheduler tick) inside one instance.
- Durable-journal chaos proofs across OS processes — SIGKILL mid-run with
  survivor takeover (completed `fx.step` never re-runs) and a two-process
  race on one due sleep (exactly one executes), gated on
  `OKE_TEST_POSTGRES_URL`.

### ♻️ Changed

- Booted apps bind `drivers.journal` from config instead of a hardcoded
  in-memory store. `postgres` without `DATABASE_URL` / `OKE_STORE_SQL_URL`
  fails loud at boot; the postgres journal pulls the `store.sql` docker
  image like clock does.
- Template / create-oke: standard + advanced gain `drivers.journal` —
  `memory` for local/test, `postgres` for docker/prod.
- `JournalStore` gains an optional lease surface — `JournalLeaseStore`
  (`acquireLease` / `releaseLease` / `claimDueSleep` / `listOrphans`),
  `hasJournalLease`, `JournalLeaseBusy`, and `JOURNAL_DEFAULT_LEASE_MS`
  (30s) are exported; memory and file stores implement it too.
- Flow / Clock docs: durable crash-recovery claims are now scoped to a
  shared journal — `postgres` resumes after restarts and across instances;
  the `memory` journal remains same-process only. At-least-once for
  in-flight steps and the client-retry boundary are documented.
- Template / create-oke docker+prod clock default: `file` → `postgres` now
  that the real CronStore exists (`file` still valid for local/single-host).
- `sently` 1.0.0 → 1.2.0 — Taqnyat OTP helpers (`sendOtp` / `verifyOtp`)
  unchanged in shape; 1.1/1.2 add vendor extras + the opt-in live-suite
  pattern mirrored by OKE's new live tests.
- Split `JournalSuspend` / `isJournalSuspend` into `journal-suspend.ts` so
  the kernel edge profile (retry filter) no longer pulls Node journal
  persistence into the browser bundle (~15.01 kB → ~13.4 kB gzip).
- `fx.store(sqlDecl)` typed as `SqlStoreHandle` (facet overloads) so
  `.upsert` / `.insert` / `.select` typecheck; SQL decls without a store
  runtime throw instead of a stub missing those methods.
- Store Seeding docs: full env matrix, simple vs complex file forms, upsert
  outcome table, CLI flags, seed-vs-migrate Callout.
- Store docs: short **Multiple environments** note under SQL schema sync —
  local `push` vs staging/prod versioned `drizzle/` + `migrate` catch-up.
- `oke db` adversarial test: multi-file `generate` + re-`migrate` skips
  applied migrations; simulated env lag applies only the pending file
  (drizzle-kit `__drizzle_migrations` history through the CLI wrapper).

### 🐛 Fixed

- Durable three-layer gap closed: with a shared journal, restarts no longer
  lose every durable run, crashed runs resume via the boot orphan scan, and
  the same run can no longer execute on two instances concurrently under a
  live lease.
- `fx.store(db).upsert` through real `oke()` → `createTestApp` → `app.fetch()`
  (regression test); SQL `StoreDecl` without a store runtime no longer
  silently returns a stub that made `.upsert` look like “not a function”.

## v0.7.0 — 2026-08-02

### ✨ Added

- `oke docker clean` — discover leftover `oke-dev-*` compose stacks and remove
  containers, networks, and volumes (`down -v`). Inside a project: current
  stack (+ optional other stacks); outside: pick any. Non-TTY: `--yes` /
  `--all --yes`.
- Signal `emit(…, { key })` — optional per-key serialization for `once`:
  same `(signal, key)` is never claimed by two consumers at once; the
  in-flight message's visibility lease is the lock (no second timeout).
  Omit `key` for unchanged competing-consumer behavior.
- Signal `schema` enforced at emit via Standard Schema (`validate()`, same
  path as Flow `in`) — invalid payloads throw **OKE1043** before stage /
  commit; valid payloads succeed.
- `create-oke` TTY wizard: template (standard|advanced) · recommended defaults ·
  customize (local|docker first, then optional other side + AI; saved to
  `~/.oke/create-defaults.json`) · reuse when saved for that template.
  Non-TTY / `--yes` stay zero-prompt.
- `oke ai setup` — interactive AI provider + curated Ollama catalog (detect /
  recommend / pull chat·vision·embed); thin paths for OpenAI-compatible and
  Anthropic. Writes `drivers.ai`, `.env.local`, and `src/ai.ts`.
- Native Ollama `embed` via `POST /api/embeddings` (no openai-compatible shim
  required for local RAG).
- `create-oke --ai` / `--no-ai` — force or skip the AI model wizard (models
  selected before install).

- `fx.store(files).image(key\|bytes)` — Bun.Image pipeline (resize / rotate /
  flip / modulate → jpeg/png/webp, plus heic/avif with WebP fallback) with
  `metadata` / `bytes` / `blob` / `placeholder` / `put` terminals; and
  `putImage(key, data, { variants, placeholder })` that writes the original
  plus `{stem}.{variant}.{ext}` derivatives and optional ThumbHash LQIP.
  Requires Bun `>=1.3.14`. Image decode defaults to a **16 MP**
  (`4096×4096`) `maxPixels` ceiling (raise or pass `false` to opt out).
- Signal `once` visibility leases (`leaseExpiresAt`, default 30s) with **lazy
  reclaim at claim time** — expired `inflight` rows are taken by the next
  consumer query (memory + postgres); no background sweeper. Chaos proof:
  SIGKILL after claim still redelivers after the lease expires.
- `createFileCronStore` — file-backed CronStore with process-safe lease CAS
  for multi-instance Clock leader election (chaos-proven with two OS
  processes).
- Clock chaos harness: two processes share one store and fire a schedule
  once; SIGKILL mid-lease takeover measured (~120ms at `leaseMs=120`);
  SIGKILL mid durable step resumes without re-running completed steps
  (file-backed journal in the chaos harness — not the in-process memory
  journal used by a booted app).

### ♻️ Changed

- Install docs list `bun install -g okengine` for a global `oke` on PATH
  (package name is `okengine`; there is no separate `oke` npm package).
- `create-oke` ships two Notes starters under `templates/{standard,advanced}`
  (named flows — no `flow_1`). TTY: pick template first; customize asks
  **local|docker** once, walks facets for that side, then optionally the other
  (defaults if no). Reuse only when saved `template` matches. `.oke/mode`
  follows primary (recommended: standard → local, advanced → docker).
- `create-oke` TTY menu offers **reuse previous settings** only when
  `~/.oke/create-defaults.json` already exists for the selected template;
  customize always saves there (user-global) so the next matching project can
  inherit the same picks.
- `create-oke` rejects a non-empty target directory at the **project name**
  step (TTY) or before scaffold (flags / `--yes`), with a clear
  `"name" already exists` message — not after the full wizard.
- `create-oke` customize wizard offers **← Back** on each driver / yes-no step
  (first-step Back returns to the recommended / reuse / customize question).
- `create-oke` customize asks AI after both env passes; when both sides are in
  play, **AI Provider — local** and **AI Provider — docker** stay available.
- `oke ai setup` Ollama path: short needs quiz (use case · speed/quality ·
  vision) → panel that separates **machine RAM** from **≈GB-class model tier**
  (comfortable / tight / too large, ~4GB OS/IDE headroom) → recommended /
  installed / manual picks with **← Back** between steps. Catalog `ramGb` is
  machine tier, not download size — a 24GB laptop is never offered a “24GB
  model.” create-oke passes `--provider ollama` when either env uses Ollama
  (even if local is mock).
- `oke ai setup` cloud providers (OpenAI, Anthropic, Gemini, OpenRouter, …)
  offer short curated **Select Chat Model** lists with ⭐ Recommended, plus
  **Other…** to type any model id (also on Ollama manual picks).
- AI docs visuals match Flow/Signal/Store quality: `AiBlocks` (model /
  prompt / embed / agent ambient demos), upgraded `AiGuardrails` with per-card
  mini physics, and `AiPiiEgress` (anthropic build-fail vs ollama on-premise)
  under the PII heading.
- Channel docs visual `ChannelPhysics` rebuilt as a Gate/Vault-quality chain
  demo: one `fx.send` walks consent → locale → same-medium `via` drivers →
  receipt, cycling clean send / opted-out suppression / catalog body miss /
  `smtp`→`resend` failover (`status: "fallback"`). Page prose corrected to
  match runtime (`via` is driver ids, not SMS→WhatsApp; locale then catalog
  fallback; dry-run is would-have-fired, not a receipt).
- Clock docs visuals match Flow/Signal quality: `ClockSchedules` (every +
  named clock → one Flow), `ClockCatchUp` (missedRuns counted, fire once),
  `ClockSleep` (durable sleep journals wakeAt across restart).
- Signal docs visuals raised to the Store/Flow quality bar: `SignalDelivery`
  mode-spotlight (competing claim / every-subscriber copy / late
  `bus.live()` history), plus `SignalOnceLease` (claim → 30s lease →
  reclaim) and `SignalLiveReplay` (retain then full-history replay) under
  the headings that teach those claims.
- Flow docs visuals: `FlowTriggers` upgraded (fan-in packet, contract chips,
  real CDC syntax) and new `FlowDurable` contrast demo — kill mid-run with
  `durable: true` resumes without re-running completed `fx.step`s.
- Gate docs visual `GatePipeline` rebuilt as a Vault-quality chain demo:
  `.gate(member, canBook, fair)` evaluates left to right, later gates skip
  after the first denial, and the outcome cycles `do runs` /
  `Unauthorized` / `Forbidden` / `RateLimited` from real principal states.
- Vault docs visuals: `VaultRedacted` (hold Redacted vs `.reveal()` at the
  provider boundary) plus polished `VaultResolution` using real
  `VaultResolutionSource` ids; mask placeholder corrected to `[redacted]` /
  `[redacted:secret]`.
- Store docs reorganized around **four facets, one handle** (`sql` · `kv` ·
  `files` · `index`) with separate Advanced sections for cross-facet and
  cross-element composition; KV + basic Files CRUD examples added from the
  real runtime API; meilisearch and image pipeline re-homed under Index and
  Files.
- Store docs visuals match Flow/Signal quality: ambient physics demos per
  facet (SQL op cycle, KV TTL expire, Files put→get, Index search fan-out)
  on `StoreFacets` and each section `StoreFacetMark`.
- Store docs: KV / Files / Index sections expanded to SQL-level depth
  (Quick start Steps, handle tables, drivers/env, examples, image options,
  meilisearch search opts, AI cross-link, facet Troubleshooting).
- Store docs physics visuals: `StoreKvTtl` (redis vs memory TTL),
  `StoreFilesVariants` (putImage fan-out), `StoreIndexModes` (vector vs
  meilisearch) — ambient demos for claims tables under-teach.
- Agent skill `oke-docs-visuals` — element-docs micro-interaction standard
  (FlowTriggers/SignalDelivery quality bar, wire checklist, RevealItem `as`
  constraints); linked from `oke-docs`.
- Engine requirement bumped to Bun `>=1.3.14` (root + `create-oke`) for
  `Bun.Image` on `store.files`.
- Homepage Store card blurb mentions image transforms on the files facet.
- Signal docs and delivery cards state real physics: **at-least-once** (not
  exactly-once), `retries` means dead-letter when `attempts > retries`,
  `live` replays full retained history (unbounded), and slow handlers that
  outlive `leaseMs` can double-deliver without a crash (no heartbeat yet).
- Signal docs: one coherent order-lifecycle example covering `once` /
  `broadcast` / `live` together (fulfillment + fan-out + status feed), with
  an explicit note that `createClient` does not yet subscribe to `live`.
- Orphan signal config stays recoverable by re-declaring; pending/DLQ rows
  are not deleted when a signal disappears from code.
- Root `README.md` redesigned for scan + first success: sently-style
  `outline` badges, starter health Flow + typed client (matches
  create-oke / Basic usage), ten-export vocabulary, eight-element
  table, Next links into the handbook; Charts and broken/duplicate
  shields removed.
- Clock docs match proven physics: catch-up `"one"` (health counts gaps,
  runtime fires once), DST is Console warn-only (not doctor / not rewritten),
  leader election requires a shared CronStore, `overridable` gates **edit**
  only, and boot clock drivers are `memory` · `file` · `frozen` (`postgres`
  rejected — no CronStore impl).
- Standard template / config docs: signal docker/prod → `redis`, clock
  docker/prod → `file`, vault local label `env` (was mislabeled `dotenv`).
- Hero banner shows Gate’s kv backend (`drivers.store.kv`); compose image
  planning no longer pulls SQL solely for fictional signal/clock postgres.
- `create-oke` runs AI **model** selection in the customize wizard (and
  `--ai`) **before** `bun install` — writes `.env.local` + `src/ai.ts`
  without spawning `oke ai setup` after install. Per-env `drivers.ai` pins
  from customize are preserved. Standalone `oke ai setup` remains for
  existing apps.
- `oke dev --docker` stops Compose containers on SIGINT / SIGTERM / SIGHUP
  / session stop (`docker compose … stop`) — volumes stay; next `oke dev`
  brings them back up.

### 🐛 Fixed

- `oke dev` parses again when linked to a local `okengine` checkout — a
  JSDoc glob (`templates/*/drizzle…`) closed the block comment early and
  broke `ensure-drizzle-config.ts`.
- Ollama docker recipe escapes shell `$pid` / `$i` as `$$` so Compose no
  longer warns `The "i"/"pid" variable is not set` on `oke dev --docker`.
- OpenBao missing-keys error names the usual cause (orphaned vault volume
  after project recreate) and prints the exact `docker compose … down -v`
  recovery for local docker.
- `create-oke` / `oke ai setup` no longer nest `drivers.ai` inside
  `channel` — the banner showed `ai: —` even after picking Ollama. AI pins
  are written as a sibling of `channel` under `drivers`.
- Console first-admin claim no longer returns an opaque **500 /
  `TransportError`** for weak passwords. The form requires ≥ 12 characters
  (letter + number), policy failures return `ClaimFailed` with a clear
  message, the wizard shows that message (not the bare code), structured
  5xx envelopes survive the client transport, and `oke dev` request logs
  print the failure detail under the status line.
- `create-oke` seeds project `.oke/mode` from the wizard profile
  (`local-only` / recommended → `local`, `docker-ready` → `docker`) so
  `oke dev` does not re-ask “Run against” after scaffold.
- `create-oke` customize no longer poisons `images` with driver pins
  (e.g. `libsql`) leaked from comments / env maps — fixes
  `oke docker: no image recipe matches "libsql"` after picking store.index
  drivers that are not compose services.
- `oke dev` auto `oke db push` no longer loops when emit rewrites
  `schema.generated.ts` — the watcher triggers only on declaration inputs
  (`schema.decl.ts` / `schema.ts` / `app.ts` / drizzle config), never the
  generated output.
- Emitting a non-`optional` signal with zero subscribers now throws
  **OKE1042** (previously silent success despite docs claiming a loud fail).
- Surfaces strip and install docs now include docs MCP on **:6536** alongside
  app / Console / MCP (the fourth `oke dev` port was missing from the cards).
- Docs site `next dev` no longer 500s on unknown `/docs/...` paths under
  `output: "export"` — export is production-only so missing pages hit
  `notFound()` instead of "missing param in generateStaticParams".
- App boot binders now honour `drivers.*` instead of silently ignoring config:
  **Vault** resolves `env` / `openbao` / `memory` / `managed` via the shared
  chain builder (same as Console); **Signal** binds `memory` / `redis` and
  fails loud for `postgres` / `nats`; **Clock** binds `memory` / `file` /
  `frozen` and rejects `postgres`; **Gate** rate KV uses `drivers.store.kv`
  (`oke:gates` namespace) instead of a private memory bag.

## v0.6.1 — 2026-08-01

### ✨ Added

- Channel drivers on [sently](https://sently.omqkhafi.dev) 1.0 —
  `sndr` (email), `taqnyat` / `msegat` / `unifonic` (SMS); `wa-cloud`,
  `webpush`, and `fcm` wrap sently transports. Boot resolves `resend` /
  `sndr` / `taqnyat` / `msegat` / `unifonic` from env. SMS fallback chains
  use sently `FallbackTransport` / `RetryTransport`. Re-exports
  `toChannelSendResult`, `parseSndrWebhook`, `parseUnifonicWebhook`, and
  `toDeliveryEvent` from `okengine/channel`.
- `scripts/webpush-interop.ts` — manual Channel → Web Push check against a
  real browser subscription (reuse sently’s subscribe page; prints push-service
  HTTP status / headers / body). Default VAPID subject uses `@example.com`
  (Apple rejects `@oke.local` / `@localhost` with `403 BadJwtToken`).
- Root `.env.example` (and create-oke template) covering Channel, Store, Vault,
  AI, and Console keys — copy to `.env.local`.

### ♻️ Changed

- Dependency `sently` bumped to `1.0.0`.
- `webpush` driver sends through sently `createPushSender` wrapping
  `WebPushTransport` (same Channel surface; push sender pipeline for hooks).
- Root `README.md` redesigned with [shieldcn](https://shieldcn.dev/) —
  adaptive glow header, shadcn-styled npm / JSR / license / Bun / stars / CI
  badges, and scaffold commands aligned to `create-oke`’s `standard` template
  (dropped the stale `--template hello`).
- Local CI test suite is leaner by default: Docker live suites need
  `OKE_TEST_DOCKER=1`, Ollama live needs `OKE_TEST_OLLAMA_URL` or
  `OKE_TEST_OLLAMA_DOCKER=1` (no auto-probe on `:11434`), create-oke
  `oke dev` boot needs `CREATE_OKE_DEV_INTEGRATION=1`, and npm pack /
  JSR dry-run run under `bun run gate` via `PUBLISH_GATE=1`.
- Site homepage motion — proof strip and budgets tree read
  `budgets.json`, Flow simulator for the one-law band, settle reveals,
  spotlights, and reduced-motion gates across the landing bands.
- Landing polish — hero fact chips share the law-chip shell (border /
  card), with a TypeScript brand mark in `#3178C6` and mono icons for
  Backend / version; Manifest wiring diagram with packet flow, and
  icons on proof / budget / surface chips.
- Hero element lattice sits lower and larger, with the lit-cell accent as
  a 1px rule on the cell’s bottom edge and a roomier docs footer; the
  collapse diagram’s idle feed lights a small multi-element operation
  each beat instead of a single concern.
- Landing budgets panel: four AGENTS caps as headline metrics (measured
  of limit, % used), then `okengine` and `okengine/plugins` as
  baselines with leaf entrypoints / per-plugin rows collapsed by
  default (Base UI Collapsible); plugins grouped auth · security · ops
  · perf — rounded timings (`36 ms`, `< 1 ms`) instead of
  false-precision decimals; Features panel keeps the shared card
  chrome.
- CI budgets measure each official `okengine/plugins` named module
  (regression group `plugins` in `budgets.json` / `BUDGETS.md`), not
  only the plugins barrel.
- One-law band: full-width claim, then two equal peer panels — a
  vertical Flow path (matching CodePanel chrome) beside the starter
  snippet, instead of stacking the diagram under the heading.
- Element feature cards drop the decorative dot lattice and drifting
  placeholder icons — content and preview chips only.
- Local `bun run ci` runs Budgets first so the cold-start probe is not inflated
  by Format/Lint/Typecheck/Tests heating the machine.

### 🐛 Fixed

- `bun run budgets` writes oxfmt-aligned `BUDGETS.md` tables, so Format no
  longer fails after every budgets refresh.

## v0.6.0 — 2026-08-01

### ✨ Added

- AI tool-calling through the same path as `fx.call` — `fx.ask(prompt, input, {
tools: [flowRef, …] })` and `fx.run(agent)` share one model-driven tool loop;
  each tool is a Flow (capability, Manifest `calls`, Runs portal). No silent
  extra authority for the model.
- Real `fx.stream` — Ollama NDJSON and `openai-compatible` SSE; cancellation
  reuses the ambient `AbortSignal` from `fx.all` / `fx.race` (one channel).
- `AI_RATE_PRESETS` / `aiRateGate("ask" | "agent" | "embed")` — Gate rate
  presets for expensive AI edges (defaults 20 / 10 / 60 per minute,
  `keyBy: "user"`). Cost caps stay on prompt/agent `budget` decls.
- Optional `headers` on AI open options (e.g. OpenRouter `HTTP-Referer` /
  `X-Title`) — still one `openai-compatible` driver, not per-vendor ids.
- Live Ollama tool-calling integration test (gated ask → real tool → ledger
  portal; skip-visible without a reachable Ollama).
- `defineLocale` / `fx.t` — register EN/AR (or any) message catalogs; `fx.t`
  resolves locale → `i18n.default` → key. Request locale comes from
  `Accept-Language` (matched against `oke.config` `i18n.locales`).
  `fx.locale` exposes the active tag; channel `fx.send` defaults to it.
  Starter ships `src/locales/en.ts` + `ar.ts`.
- ICU MessageFormat for `fx.t` (FormatJS `intl-messageformat`) — interpolation,
  cardinal/ordinal plurals, `select` / `selectordinal`, and rich-text tags
  (`<tag>…</tag>` with function values).
- Type-safe message keys — `defineMessages`, `MessagesFor<typeof en>`, and
  `declare module "okengine" { interface Register { messages: typeof en } }`
  so `fx.t` autocompletes keys and rejects typos at compile time.
- Docs — [i18n](/docs/reference/i18n) reference page (ICU catalogs, typed keys,
  locale matching, built-in failure messages vs Channel `{{field}}`).
- `magicLink` / `emailOtp` Channel catalogs include Arabic bodies alongside
  English (`locales: ["en", "ar"]`).
- Built-in EN/AR ICU catalogs for typed failures (`errors.*`) and OKE codes
  (`oke.*.cause` / `oke.*.fix`). `fail` / `fx.fail` attach a localized
  `error.message` from the active request locale; thrown `OkeError` localizes
  cause and fix. Override via `defineLocale`; explicit `{ message }` wins.
- `ollama` AI driver — thin native `POST /api/chat` client for any pulled
  model (`OKE_AI_MODEL` / `ai.model`); documented local-dev default
  `qwen3.5:9b` (balanced starting point, fully overridable; Apple Silicon
  can use `qwen3.5:9b-mlx`). Base URL `http://127.0.0.1:11434` via
  `OKE_AI_URL` / `OLLAMA_HOST`. Unreachable servers throw
  `OllamaUnavailableError` — never a silent mock fallback.
- Ollama Docker recipe (`images.ai: "ollama/ollama"`) — pulls the configured
  model, health-checks, writes `OKE_AI_URL`. Boot resolves `drivers.ai`
  through a shared `aiDriverFor` switch (same class as store.index).
- Live Ollama integration test (real completion; skips visibly without a
  reachable Ollama / explicit Docker opt-in).
- `magicLink` / `emailOtp` deliver challenges via Channel (`fx.send` +
  `auth-magic-link` / `auth-email-otp` templates and English catalog bodies).
  `exposeDevToken` / `exposeDevOtp` stay for local DX without SMTP. `phoneNumber`
  SMS delivery remains deferred.
- Plugin API `.channelCatalog(catalog)` — merge template bodies into boot
  Channel catalog (parallel to `.channelTemplate`).
- Mailpit integration tests prove real SMTP capture of magic-link token/link
  and email OTP (skip with a visible warn when Docker is unavailable).
- `username({ usernamePolicy, passwordPolicy })` — tunable min/max length,
  charset, letter/number/symbol requirements, and reserved names on sign-up.
  Policy failures return `AuthFailed` with `reason: "username_policy"` /
  `"password_policy"` and a `reasons` array (taken usernames stay
  enumeration-safe as `invalid_credentials`).
- `username` default reserved blocklist (`DEFAULT_RESERVED_USERNAMES`) —
  `admin` / `root` / `api` / `auth` / `anonymous` and peers. `reserved: []`
  opts out; a custom list replaces (does not merge).
- `usernamePolicy.extraAllowedChars` — append characters to the default
  (or `allowedChars`) charset without replacing the whole set.
- `usernamePolicy.extraReserved` — append names to the default (or
  `reserved`) blocklist without replacing it.
- `usernamePolicy` shape rules — `mustStartWithLetter`,
  `forbidEdgeSymbols` (default on), `forbidConsecutiveSymbols` (default on).

### ♻️ Changed

- Ollama documented local-dev default model is `qwen3.5:9b` (was
  `qwen3:8b`; same as `qwen3.5:latest` on the [Ollama library](https://ollama.com/library/qwen3.5)).
  On Apple Silicon, set `OKE_AI_MODEL=qwen3.5:9b-mlx` for the MLX build.
  Docker recipe / compose control use the non-MLX tag.
- `openai-compatible` AI driver is the shared chat/completions client for
  OpenAI, Groq, Together, OpenRouter, vLLM, LM Studio, and Ollama `/v1` —
  configure via `baseUrl` + `apiKey` + `model`. apiKey is required only for
  the default OpenAI cloud base; custom bases may omit it. Native `ollama`
  remains the first-class local path.
- Native `ollama` driver adds tools + streaming (`stream: true` NDJSON) on
  `/api/chat` (still fail-loud; never silent mock fallback).
- Effect inference: `fx.ask(…, { tools: […] })` with static Flow refs adds
  them to Manifest `effects.calls`.
- Rebased export/driver budgets after AI depth (tools, stream, rate presets)
  and related Unreleased work; refreshed `budgets.json` / `BUDGETS.md`.
- Rebased the Store-only `oke()` gzip graph baseline (41.4 kB → 50 kB) after
  shared `fx` growth (stream + i18n).
- Rebased the `plugins` export budget after Channel delivery wiring
  (13.84 kB → 14.77 kB), and refreshed the published budgets snapshot.
- Rebased the `plugins` export budget after username policy wiring
  (14.77 kB → 15.54 kB), and refreshed the published budgets snapshot.
- Rebased the `plugins` export budget after username Gate-auth parity
  (15.54 kB → 15.97 kB), and refreshed the published budgets snapshot.
- `username()` sign-up inherits `gate.auth.passwordPolicy`, `password`
  hash knobs, and `breachCheck` (same as email/password Gate auth).
  Explicit plugin opts still override for that method only.

### 🔒 Security

- `Redacted` values in `fx.ask` / stream prompts are masked with
  `[redacted]` before they reach any provider (same class as `fx.log`).

### 🐛 Fixed

- `smtp` channel driver passes sently's `BunAdapter` so real SMTP (Mailpit /
  providers) works under Bun — previously failed with "No socket adapter
  configured".
- Mailpit auth-delivery tests use real `test.skip` when Docker is unavailable
  (never an empty pass).

## v0.5.1 — 2026-08-01

### ♻️ Changed

- Official plugin rename: `securityHeaders()` / `"security-headers"` →
  `headers()` / `"headers"` (options type `HeadersOptions`; config table
  `headers_config`). Docs page was already `/docs/plugins/headers`.
- Rebased the `plugins` export budget after passkey WebAuthn verify
  (13.21 kB → 13.84 kB), and refreshed the published budgets snapshot.
- `site` joins the version lockstep (`bun run bump` updates
  `site/package.json` with `okengine` + `create-oke`).
- Site depends on `@fumadocs/base-ui` (`^`) directly — dropped the
  `fumadocs-ui` npm alias.

### 🔒 Security

- `twoFactor` TOTP verify uses constant-time comparison across the ±1 step
  window (no plain `===` short-circuit).
- `passkey` register / authenticate now require a real WebAuthn ceremony:
  `clientDataJSON` origin + challenge, `authenticatorData` rpId hash, and
  ECDSA P-256 signature against the stored SPKI public key. Presence-only
  authenticate is rejected; challenges are single-use. New option `origins`.
- Exploit-proof HTTP audit tests for all seven Gate auth method plugins
  (rate limits, gate posture, single-use tokens, anonymous non-escalation,
  Channel delivery gap, TOTP compare, passkey signature/origin).

## v0.5.0 — 2026-08-01

### ✨ Added

- `oke({ gate })` — nested Gate bag (`auth`, `policies`, `rateLimit`,
  `unguardedHttp`). Builtin hybrid auth materializes `/auth/*` as real
  Bindings on the same `ensureBoot → doBoot` posture path; `.needs("auth")`
  is satisfied without `.plug(auth())`. Schema customize +
  `oke schema generate` emit real columns; opt-in cookies, kv secondary,
  hooks, `freshAge`, auth rate presets, enumeration-safe credential errors.
  Docs · [Gate](/docs/elements/gate).
- `okengine/client/auth` helpers (`memorySession`, `AUTH_ERROR_CODES`) and
  `okengine/client-react` `useSession` — still one client (`createClient`).
- Gate auth method plugins (`okengine/plugins`): `username`, `anonymous`,
  `magicLink`, `emailOtp`, `phoneNumber`, `twoFactor`, `passkey` — each
  `.needs("auth")` and contributes HTTP Bindings under `/auth/...`.
  Docs · one page per method under [Plugins](/docs/plugins)
  (`username`, `anonymous`, `magic-link`, `email-otp`, `phone-number`,
  `two-factor`, `passkey`).
- Docs · [Client](/docs/reference/client) — `okengine/client` reference
  (`createClient` forms, REST vs RPC, Bearer auth + gate denials,
  elements-from-the-client, envelope helpers, `oke client add`).
- Homepage **Onboard AI** button (hero CTAs) copies a short bootstrap
  prompt pointing at the live `/llms.txt` index and the repo-root
  `AGENTS.md` — distinct from the per-page docs “Copy prompt” action.
- Docs section landings at `/docs/get-started`, `/docs/elements`,
  `/docs/plugins`, `/docs/console`, `/docs/reference`, and `/docs/ai` —
  definition plus Cards routing for direct URLs (not listed in the
  sidebar).
- Site 404 page — branded “No Flow matched” composition with the
  unmatched path, a probing trigger→Effects visual, and home / docs CTAs.
- `gate.scope(name)` — sugar for
  `gate.policy(name, ({ auth }) => auth.scopes.has(name))` (single source
  of truth for the scope string).
- `gate.public` — explicit public sentinel for intentionally
  unauthenticated HTTP surfaces; name `"public"` is reserved.
- `GateBootError` — every HTTP trigger must carry a gate or `gate.public`
  at boot (fail loud). Test-only opt-out: `unguardedHttp: "allow"` when
  `env === "test"` (`createTestApp` opts out for the harness).
- Docs · [Gate](/docs/elements/gate), [fx](/docs/reference/fx),
  [Plugins](/docs/reference/plugins), [Client](/docs/reference/client),
  [Console Gates](/docs/console/gates) — auth posture, `gate.scope` /
  `gate.public`, `fx.principal`, `.needs()`, unguarded vs explicit public.
- `fx.principal` — read-only originating identity for audit; propagates
  across `fx.call` without filling `fx.auth` (authorization stays
  fail-closed).
- Auth password policy (`assertPasswordPolicy`), Bun.password cost knobs
  (`memoryCost` / `timeCost` with Bun argon2id floor), pluggable
  breach-check + `createHibpBreachCheck` (HIBP k-anonymity range API),
  and session idle / absolute / single-session-per-user options on
  `auth()`.
- Plugin `.needs()` resolution at boot (`PluginNeedsError`) for plugin
  names and element/driver ids.
- Plugin element contributions: `.vault()`, `.clock()`, `.signal()`,
  `.gate()`, `.channelTemplate()` — merged into boot options.

### ♻️ Changed

- Root `oke({ auth })` / `oke({ gates })` / `oke({ unguardedHttp })` moved
  to `oke({ gate: { auth, policies, unguardedHttp } })` (hard migrate).
  Console uses `gate.auth` with `http: false` (keeps `/console/session/*`).
- Plugin `.binding()` contributes HTTP Bindings into the app router on
  `.plug()` (auth method plugins); SmartRouter build is deferred until
  first match so plugs can still add routes.
- `fx.metric` recorded as investigated and **declined**: Runs wide events
  already cover per-invocation observability; no parallel counter/gauge API
  (see `reports/2026-07-31-fx-metric-decision.md` and the fx reference).
- Console HTTP bindings auto-attach `gate.public` or
  `console:operator` for auth posture; Gates panel distinguishes
  unguarded vs explicit public.

### 🔒 Security

- HTTP empty gate chains no longer silently public at boot — declare a
  gate or `gate.public`. `unguardedHttp: "allow"` is honoured **only**
  when `env === "test"` (never a production-wide bypass).
- `autoBoot` now defaults to `true` — the first `fetch` / `execute`
  runs full boot (gate posture, vault, capabilities, element pipeline).
  Pre-boot ungated execution requires an explicit
  `oke({ autoBoot: false })` (unit-test escape hatch only). No shipping
  path had been setting `autoBoot: true`; CLI/Console already called
  `.boot()` explicitly, but bare `oke({…}).fetch()` was silently ungated.
- Default password policy enforced on `createOperator` (minLength 12,
  letter + number); tests needing short passwords must pass
  `skipPasswordPolicy: true` explicitly.
- `POST /auth/sign-up/email` maps password-policy / breach-check failures
  to `AuthFailed` (`reason: "password_policy"` | `"password_breached"`)
  instead of an empty `204` from an unhandled throw. Weak passwords were
  never stored; the status alone looked like silent success.

### 🐛 Fixed

- `gate.public` is always seeded into the Gate runtime — attaching
  `.gate(gate.public)` on a trigger no longer denies with
  `Unauthorized` / `unknown gate: public` when the sentinel was not
  also listed in `oke({ gates })`.
- Console `.oke/console.sqlite` sessions persist and hydrate
  `last_active_at` (idle TTL); older DBs gain the column on open.
- Site `next build` no longer fetches Inter from Google Fonts at build
  time: Inter Variable is vendored under `site/app/fonts/` (OFL) and
  loaded via `next/font/local`, so offline / network-restricted CI builds
  cannot fail with a fonts.gstatic.com 403.
- Unhandled throws in HTTP Flows encode as `500 InternalError` — never
  as empty `204` (which `encodeSuccess(undefined)` previously produced).
- Docs · auth method plugin Quick Starts enable `oke({ gate: { auth } })` before
  `.plug(...)` (`.needs("auth")`); Client notes built-in `POST /auth/refresh`;
  Gate docs cover session idle/absolute/`singleSessionPerUser` and
  `createHibpBreachCheck`; drop false Console rate-limit retune claims.
- Homepage element lattice — compact phone layout, stacked chrome, and no
  spotlight/hover chase on coarse pointers (touch).

## v0.4.3 — 2026-07-31

### 🐛 Fixed

- Site search client matches fumadocs 16.14's ZBSearch move: use
  `staticClient` (no custom `@orama/orama` init). Fresh installs were
  failing `next build` typecheck under `useTypeScriptCli`.

## v0.4.2 — 2026-07-31

### 🐛 Fixed

- `bun run bump` updates package/jsr `"version"` fields in place so oxfmt
  compact arrays in `jsr.json` are not rewritten into multi-line form
  (which failed `fmt:check` after the v0.4.1 cut).

## v0.4.1 — 2026-07-31

### 🐛 Fixed

- Competitor-mention gate no longer matches its own comment: the Rust-core
  peer name in the allowlisted split comment is split the same way as the
  search needle.
- Site `next build` with TypeScript 7: enable `experimental.useTypeScriptCli`
  so Next runs the project-local `tsc` instead of the removed JS compiler API,
  and point it at `tsconfig.build.json` so Bun `*.test.ts` files stay out of
  the production typecheck.

## v0.4.0 — 2026-07-31

### ✨ Added

- `Redacted<T>` — a plain value wrapper for secrets at the value level.
  `fx.vault` now returns `Redacted<string>`: printing, logging, or JSON
  serialization yields a fixed placeholder, never the real value; `.reveal()`
  is the one explicit unwrap, called once at the credential boundary (drivers
  unchanged — they take plain strings at boot). `fx.log` (all levels)
  deep-masks any `Redacted` found anywhere in the logged data, nested
  included, on top of the existing boot-registered substring scrub.
  Orthogonal to effect tracking — the Manifest still records secret _names_.
- `fx.using(acquire, release, use)` — scoped resource cleanup that completes
  the structured-concurrency surface. `release` runs exactly once when `use`
  settles or when the ambient abort signal fires (a sibling `fx.race` winner
  or failing `fx.all` branch), reusing the Prompt-57 ALS signal rather than a
  second cancellation channel. Process-local only — not journaled, and not
  for handles held across durable park/resume.
- `oke-deps` agent skill — scoped dependency updates (one package, one
  `package.json`, or all) with Bun + `ncu`, pin/alias guards, and
  install verification. Documented under Skills; linked from `AGENTS.md`.
- `meilisearch` as an opt-in fourth `store.index` driver — full-text,
  typo-tolerant, faceted search as a genuinely different capability from the
  vector ANN drivers (`memory` / `pgvector` / `libsql`). `IndexStore` is now
  a discriminated union on `driverId`, so TypeScript rejects a vector query
  against a text index (and vice versa) at compile time, never at runtime.
  Local mode spawns a `meilisearch` binary from `PATH` with a generated
  master key under `.oke/meilisearch/`; docker/prod uses a
  `getmeili/meilisearch` image recipe. Not the default — `memory` stays the
  default and meilisearch is wired explicitly per env.

### ♻️ Changed

- Collapse diagram (homepage / Why OKE): each element cluster now has a
  labelled ring arc, and the live chips name the active source plus its
  destinations (A → B, C, D) instead of a single anonymous node. Chips sit
  on the node's outward ray, well clear of the group-name band; the
  connector is a technical leader — pin at the node, creeping data dash,
  and on diagonals a bent end that plugs square into the chip edge — and
  collision layout pushes or drops overlapping destinations. Group names ride the arc on a
  textPath so they curve with their cluster; names below the horizontal
  midline run the other way along the arc so they stay upright.
- Get-started docs replace the Comparison page with **Why OKE** — an
  evergreen case around traditional backend pain points (cache invalidation,
  secrets sprawl, hand-rolled headers, bolted-on observability, ad-hoc
  capabilities) and what Manifest / `fx` / Vault / Console / official plugins
  already close. Ambition stated plainly; pre-1.0 maturity kept honest.
- Get-started pages (Introduction, Why OKE, Installation, Basic Usage)
  rewritten to the oke-docs standard: one-rule Callouts, Quick start Steps,
  Learn more / Next Cards, real Troubleshooting Accordions, and source-verified
  claims (corrected stale `--sql postgres` / `pgTable` wording and template
  examples). Prose-density gate now covers `get-started/`.
- Introduction and Why OKE restructured: Introduction teaches Flow → `fx` →
  Manifest → eight elements → ten exports with a real Quick start; Why OKE
  replaces the mega-table with seam-by-seam sections (cache, glue, secrets,
  observability, permissions, local≠prod) plus ambition/maturity.
- Get-started visuals: every get-started page carries a diagram that earns
  its place — Introduction (`FlowShape`, `ManifestPipeline`, `Features`,
  `Vocabulary`), Why OKE (`DriftBoard`, `CollapseBoard`), Installation
  (`Surfaces`, `DevModes`), Basic Usage (`Surfaces`, `FlowShape`, `ClientLoop`).
  Custom `FlowShape` / `DevModes` / `ClientLoop` / `DriftBoard` /
  `CollapseBoard` plus landing reuse registered in the docs MDX map.
- Why OKE refactored around felt pain: six seams written as incidents (the
  cache that lies, the secret that fails in prod, the glue you rewrite, the
  dashboard that doesn't know you, the permission check in the wrong place,
  local≠prod), each closed by what OKE derives. New `DriftBoard` visual shows
  one change propagating two ways — hand-maintained copies scatter versions
  and stay scattered, Manifest derivations flip in sync — replacing the two
  duplicate pins/features tables with one summary table.
- Docs visuals are now micro-simulations of their own physics, not static
  diagrams with a fade-in: a request token traverses the Gate pipeline (every
  third run denied with a cycling typed failure), a probe descends the Vault
  resolution chain (hit cycles layers; every sixth run misses all →
  `VaultBootError`), Flow triggers fire in turn into one Flow, Signal cards
  run once/broadcast/live delivery demos, Clock ticks a metronome vs a cron
  dial, a send travels Channel's consent→locale→fallback→receipts, and
  `fx.ask` is checked against each AI guardrail with verdicts. All driven by
  a shared deterministic beat clock (`useTick` + `BeatPing` in
  `components/docs/reveal.tsx`), hydration-safe, reduced-motion-aware
  (static snapshots), and toned in each element's canonical ink.
- `CollapseBoard` — a compact docs-side telling of the integration curve
  (Why OKE), replacing the 955px landing stepper in the article. The same 40
  concerns on one ring twice: zoo mesh (136 seams) beside the hub collapse
  (48 edges), with the change feed costing one live change in both shapes
  (up to 15 seams re-checked vs always 2 edges). The full CollapseDiagram
  stays on the landing page.
- Bumped root dependencies: `oxc-parser` / `@oxc-project/types` to
  `0.142`, `vite` to `8.2`, Playwright to `1.62.1`, plus patch updates
  for DuckDB, CodeMirror, React types, and `@vitejs/plugin-react`.
- Bumped site dependencies: fumadocs to `16.14` / MDX `15.2.1`, Next to
  `16.2.12`, `cnfast` to `0.1`, TypeScript to `7`, plus patch/minor
  updates for lucide, framer-motion, postcss, and React types.

### 🔥 Removed

- Named peer comparison matrix and head-to-head positioning copy from
  get-started docs, landing attribution comments, and related satellite
  mentions. A `git grep` gate keeps those names out of the tree.
- `infisical` vault driver (`vault-infisical` / `infisicalVaultDriver`) — drop
  the unused SaaS-shaped secrets backend. Vault drivers that remain:
  `env` · `openbao` · `managed` · `memory`.

### 🐛 Fixed

- Site header active-tab underline no longer floats above the border when
  switching surfaces. Replaced the Framer `layoutId` morph (which fought the
  brand-cell width spring) with a single measured bar that only animates
  `x` / `width`.
- Console production builds resolve shared display labels across element panels.
- Animated docs favicons no longer remove Next-managed metadata nodes during navigation.
- `bump-version --dry-run` rehearses cleanly right after a release: an empty
  `## Unreleased` now prints a note instead of failing (real bumps still
  refuse to cut an empty release), so the publish gate stays green in the
  post-release window.

## v0.3.6 — 2026-07-31

### ✨ Added

- `oke-ship` agent skill — after every implementation, append changelog
  notes under `## Unreleased` and sync site docs via `oke-docs`.
  Wired into `AGENTS.md` so sessions close work with changelog + docs.
- `libsql` and `pglite` Store SQL drivers as optional peers. libSQL adds
  native `F32_BLOB` / `vector_top_k` ANN; PGlite provides opt-in
  PostgreSQL + pgvector parity without changing the local SQLite default.
- Real pgvector ANN for PostgreSQL and PGlite: `vector(dims)` storage,
  HNSW with cosine operators, and similarity-ranked search through
  Drizzle's native vector API.
- Optional `description` on element declarations — `store.*`, `signal`,
  `channel.template`, `clock`, `gate.policy` / `gate.rate`,
  `field.*.describe(…)`, and `plugin.table` — extracted into the
  Manifest and preferred as Console titles when set (raw key fallback).
- `fx.all` / `fx.race` — structured concurrency on plain Promises:
  pass thunks, first failure or settle aborts sibling branches via an
  ambient `AbortSignal` (`fx.signal`). No generators or monadic wrapper.
- `fx.retry(fn, { retries, delay, backoff, jitter, when? })` — exponential
  backoff with full jitter. Prefer inside `fx.step` so durable replay
  skips completed work.
- `flow({ retry })` — coarse whole-`do` retry on the same journal session
  (rewinds the durable cursor between attempts).

### ♻️ Changed

- `bun run bump` promotes `## Unreleased` into `## v{next} — {today}`
  (and leaves a fresh empty Unreleased). Changelog notes for unfinished
  work no longer land on an already-shipped version section.
- SQL-backed indexes share the SQL facet's existing connection. PGlite
  remains an explicit dialect-parity choice; measured WASM startup and
  warm CRUD remain meaningfully slower than native SQLite.

### 🐛 Fixed

- `store.index()` now honors `drivers.store.index` at real boot and uses
  the same driver switch in the Console. Explicit `pgvector` or `libsql`
  configuration fails loudly when its SQL engine, extension, or optional
  peer is unavailable instead of silently using memory.

## v0.3.5 — 2026-07-31

### ♻️ Changed

- `bun run ci` is the single local pre-push gate (format, lint, typecheck,
  integration tests, budgets, gate, site). Removed the unused
  `ci:workflow` split.
- Tag-push CI no longer re-runs budgets (local-only); parallel jobs stay
  lint/fmt, typecheck, test, gate, site → publish.
- GitHub Actions runtimes upgraded off deprecated Node 20:
  `actions/checkout@v6`, `oven-sh/setup-bun@v2.2.0`, `actions/setup-node@v6`.

## v0.3.4 — 2026-07-30

### 🐛 Fixed

- Re-release of v0.3.3 so tag CI can publish: OpenBao bootstrap waits for
  Raft `/sys/health` active before policy writes, and the `plugins`
  export budget is rebased after the CORS / IP-allowlist hardening.

## v0.3.3 — 2026-07-30

### ✨ Added

- `ipAllowlist({ trustedProxyDepth })` — how many trusted proxies append to
  `X-Forwarded-For` (default `1`). Client IP is taken that many hops from
  the right, matching how reverse proxies append rather than overwrite.

### ♻️ Changed

- Site logo assets live under `site/public/logo/` (wordmarks + letter
  variants); README and favicon paths follow. The docs site cycles the
  O / K / E favicon letters.
- Rebased the `plugins` export budget after the CORS / IP-allowlist
  hardening (4.45 kB → 4.74 kB), and refreshed the published budgets
  snapshot.

### 🐛 Fixed

- `cors({ origin: "*", credentials: true })` now throws at construction
  (and again if runtime config introduces the pair) instead of reflecting
  the request origin — that rewrite would have granted any site
  credentialed access.
- `ipAllowlist` no longer trusts the leftmost XFF hop (spoofable when
  proxies append). Wrong or non-positive `trustedProxyDepth` fails loud.
- OpenBao bootstrap waits for `/sys/health` active (Raft leader writable)
  after unseal before mounts/policies — fixes flaky restart CI when
  single-node Raft still reports `readonly storage`.

## v0.3.2 — 2026-07-30

### ♻️ Changed

- Rebased the `vault-openbao` export budget after a genuine size increase
  (608 B → 1.06 kB), and refreshed the published budgets snapshot.

### 🐛 Fixed

- Docs skill forbidden-token lists no longer trip the stack-mode and
  removed-driver `git grep` gates (tokens are split the same way the
  gate tests avoid matching themselves).
- Restored the missing `bun run gate` script so CI’s gate job runs again
  (staleness, removed-driver, error-registry, and upgrade codemod checks).
- Renamed and scrubbed the removed-driver gate file so it does not match
  its own forbidden id under case-insensitive search.

## v0.3.1 — 2026-07-30

### ♻️ Changed

- Docs origin cut over from `okengine.vercel.app` to
  [`oke.omqkhafi.dev`](https://oke.omqkhafi.dev). Error links, README,
  scaffold next-steps, site `metadataBase`, and `llms.txt` examples now
  point at the custom domain.

## v0.3.0 — 2026-07-30

### ✨ Added

- Official plugins — first-party extensions shipped inside `okengine`,
  importable from `okengine/plugins` and attached with `.plug()`, built
  entirely on the public plugin API. The set: `securityHeaders()` (full
  helmet.js parity with API-first defaults — the complete secure-headers
  set on every response, failures included, plus a CSP builder with
  report-only mode), `cors()` (preflight `OPTIONS` answered at the edge
  even for paths bound to other methods; closed by default), `csrf()`
  (stateless fetch-metadata defense with an `Origin` fallback — no
  tokens, no cookies), `compression()` (native `Bun.gzipSync` for
  clients that accept gzip, with size and content-type thresholds),
  `maintenanceMode()` (one-flag 503 drain with `Retry-After`,
  allow-listed paths, and an operator bypass header), and
  `ipAllowlist()` (allow/deny rules by client IP at the edge of the
  pipeline). All no-op safely on non-HTTP triggers.
- `configSource()` — runtime-mutable plugin configuration: code as the
  floor, a DB row as the source of truth, and a KV binding as the
  automatic read-through cache. Every official plugin accepts one in
  place of static options; one clock-bound sync flow (declared effects,
  so the fx rule holds) refreshes the in-memory box that hooks read.
  Flip maintenance mode, open a CORS origin, or enable HSTS from the
  database — no redeploy.
- Plugin API: new `.edge(fn)` contribution — handlers for HTTP requests
  that match **no** flow (e.g. CORS preflight for a path bound to
  another method), run in install order before the plain 404, recorded
  as an `edge` intercept capability. The CORS plugin is built on it.
- Kernel: HTTP flows now serialize their outcome into `ctx.response`
  **before** the `onResponse` pipeline stage, so the last stage sees — and
  may replace — the final response, as `InvocationContext.response` always
  documented. Encoder input mirrors the app layer exactly; non-HTTP
  triggers are unchanged.
- Docs MCP: `oke dev` now boots the read-only docs MCP server next to the
  runtime MCP — app :6530 · Console :6533 · MCP :6535 · docs MCP :6536. No
  Bearer token (public documentation). Tools: `oke.docs.search`,
  `oke.docs.get` — agents answer "how do I … in OKE?" from the real pages
  instead of training-data memory. Docs content now ships inside the
  published package so the surface works in installed apps. Boot failure
  (missing content, busy port) skips the surface, never takes `oke dev`
  down.
- Documentation overhaul — all eight element pages rewritten to one
  standard (quick start → contract → per-environment drivers →
  troubleshooting). New sections: Reference (`oke.config.ts` options,
  environment variables, error codes, the full `fx` API, plugin API),
  AI Resources (runtime + docs MCP, agent contracts and skills,
  `llms.txt` endpoints), and a categorized Plugins section (Security ·
  Operations · Performance). CLI Reference and Security moved under
  Reference.

### ♻️ Changed

- Vault: real OpenBao is now the `docker` / `prod` default driver (durable
  single-node Raft, real init/unseal, least-privilege app token). The
  previous age-based driver and its optional peer dependency were removed
  entirely. Single-point-of-failure by design: back up
  `.oke/openbao/unseal.key` to a separate safe location — losing it means
  losing every secret permanently, with no recovery.

## v0.2.9 — 2026-07-29

### ✨ Added

- `store.resource(db, table, opts)` — declarative CRUD factory nested on
  `store`. Expands into five ordinary `flow({…})`s (`list` / `create` / `get` /
  `update` / `remove`) plus `all()`. Sugar over `fx.store(db)`, never new
  physics; the ten exports stay unchanged.
- `http.resource(path, ops)` + `on(mount)` overload — mounts all five verbs
  (list/create on `path`, get/update/remove on `path/:id`) and returns the ops
  bag for `adopt`. Manifest extract expands the multi-bind statically.
- Complete list URL (PostgREST-shaped, UTF-8 values — English, Arabic, …):
  `?cursor=` / `?offset=` / `?limit=` · `?search=` (`?q=` alias) ·
  `?col=op.value` (`eq ne gt gte lt lte like ilike in is`) · `?or=(…)` /
  `?and=(…)` · `?order=col.desc` · `?select=id,title`. Every surface is
  whitelisted by a ColumnScope (`"all" | Column[] | "none"`).
- `fx.json.ok` / `create` / `empty` / `with` — Stripe-style `{ data, meta,
error }` envelope; `create` → 201, `empty` → 204, list pages attach
  top-level `meta` (`nextCursor`, `hasNextPage`, …). `ClientResult` and the
  in-process test client expose `meta`.
- `fx.store(db).page` / `.count`, fluent `.offset()`, and condition-compiler
  support for `inArray` / `isNull` / `isNotNull` (memory driver matched).
- `OkeOptions.registry?: "consume" | "keep" | "ignore"` (default `consume`) —
  isolates the process-wide `on()` bindings registry so a later `oke()` cannot
  inherit another app’s routes. Console uses `ignore`. Proven by
  `registry-isolation.test.ts`.
- `flow({ breaking: true })` / `store.resource({ breaking: true })` —
  acknowledge intentional Manifest contract breaks for `oke doctor --diff`.

### ♻️ Changed

- Notes teaching app rewritten onto `store.resource` + `on(http.resource(…))`
  with cursor pages, multilingual search, filter/order/select, and 201/204
  status tests. Spec, Learn · Notes, Store element docs, README, and homepage
  snippet regenerated.
- Export gzip baselines refreshed for the intentional `store.resource` /
  memory-driver growth (`okengine`, `store`, `console`, `drivers`, `memory`).

### 🐛 Fixed

- Latent `or(...)` silently flattening into AND in the SQL condition compiler
  (parenthesized OR groups; unsupported ops throw).
- Partial `update().set()` no longer re-applies `$defaultFn` to untouched
  columns via `prepareInsertRow`.

## v0.2.8 — 2026-07-29

### ✨ Added

- Abstract store schema: `store.schema.table` + `field.text` / `field.integer`
  (modifiers + `.pii()` / `.sensitive()` / `.retain()`). ORM-agnostic declare
  site; `oke db push|generate|migrate` emits dialect-specific Drizzle
  (`src/schema.generated.ts`) as a pre-step from `src/schema.decl.ts` and/or
  live plugged plugin tables — not a third schema CLI. Hand-written `schema.ts`
  remains the escape hatch. Prompt 42 / OKE1101 / docker-prod never-auto-DDL
  unchanged.
- Store foreign keys and relations: `field.*.references(() => table.col)` and
  `store.schema.relations({ … }, (r) => …)` mirroring drizzle-orm@1.0.0-rc.4
  `defineRelations` (`r.one.*` / `r.many.*` + `from` / `to`). Same emitter
  pre-step writes FK chains + `defineRelations` into `schema.generated.ts`.
  Linkly’s `daily`→`links` relationship is the first real usage. Many-to-many
  is a junction table with two one/many relations — no separate API. Declared
  relations do not change Manifest `reads` (`fx.store` remains single-table).
- Plugin `.table(name, columns?, options?)` accepts `field.*` column maps;
  contributions merge into the same emitter. **`oke db` loads the live app
  entry** (`src/app.ts` / `db.entry`) and merges `app.plugins.tableContributions()`
  at push/generate/migrate time (and on `oke dev` auto-push). **Known v1
  limit:** plugins add whole tables only — no column injection into
  app-owned tables.
- Manifest `$defs/DeclaredColumn` (additive); compiler extracts
  `store.schema.table` columns + PII into `stores.*.tables.*.columns`.
- `oke db push|generate|migrate` — domain schema sync via drizzle-kit
  (distinct from `oke schema generate` core/plugin stubs). Local `oke dev`
  auto-runs `oke db push` when `schema.ts` / `schema.decl.ts` / `app.ts`
  changes (opt out: `--no-db-push` or `db: { autoPush: false }`). Docker/prod
  never auto-apply DDL; missing tables remapped to `OKE1101` with fix
  `oke db migrate`.
- Templates/examples ship `drizzle.config.ts` (`out: ./drizzle`) plus
  `drizzle-kit` as a devDependency.

### ♻️ Changed

- Docs now state the relational-query limit explicitly (investigated, not a
  feature): Drizzle RQB `db.query.*.findMany({ with: … })` is **not**
  supported through `fx` — `fx.store` is a single-table session, so effect
  inference, cache keys, and PII masking stay exact. Compose separate
  single-table `fx.store` reads (or `fx.call`); each table then appears in
  Manifest `reads` / `writes`.
- `create-oke` interactive wizard no longer asks for Store SQL driver; default
  dual-mode (`local: sqlite` · `docker`/`prod: postgres`) stays, with
  `--sql postgres` still opt-in for a pinned `pgTable` scaffold.
- Soft-compat: legacy `dev`/`stack` keys in `oke.config.ts` warn and normalize
  to `local`/`docker`. CLI stack flags remain hard-removed (`--stack`/`-s`,
  `OKE_STACK`, `.env.stack`, `fromStack` — `oke upgrade` rewrites leftovers).

## v0.2.7 — 2026-07-28

### ✨ Added

- `create-oke --sql sqlite|postgres` (wizard prompt too): `postgres` rewrites
  `src/schema.ts` to `pgTable` and pins `oke.config.ts` `store.sql`
  local/docker/prod; default `sqlite` keeps the dual-mode template pins with
  `sqliteTable`.
- Handbook **Get Started → Deploy**: protocols from `oke.config.ts`, connection
  values from `process.env`, staging as a second deploy, `oke docker --prod` /
  `oke start`. Template `.env.example` and READMEs document `DATABASE_URL` /
  `REDIS_URL` vs vault app secrets.
- `resolveConfigEnv` — boot selects `docker` / `prod` / `test` / `local` from
  `OKE_DOCKER` and `NODE_ENV` when `$options.env` is unset (templates no longer
  hardcode `env: "test"`).
- Mailpit and RustFS image recipes for local SMTP catcher / S3-compatible
  object storage under `oke dev --docker`.
- `CONTRIBUTING.md` and `docs/guides/writing-a-driver.md` (ClickHouse runs
  worked example).
- `.env.example` for every template and teaching example, with inline docs.

### 🐛 Fixed

- `docker/.env.docker` is recipe-accurate: Postgres keeps USER/PASSWORD/DB;
  Redis emits PASSWORD (+ `REDIS_URL`) only; S3 uses ACCESS_KEY/SECRET_KEY/
  BUCKET (+ `S3_*` / `AWS_*` aliases and console `UI_URL`); Mailpit emits
  SMTP URL (+ `SMTP_URL`) and UI URL — no fake USER/PASSWORD/DB.

### ♻️ Changed

- `oke.config.ts` driver maps: `dev` → `local`, `stack` → `docker`. Boot uses
  `env: "local"` by default and `env: "docker"` under `OKE_DOCKER=1`.
  Compose credentials write `docker/.env.docker` (legacy project-root
  `.env.docker` still read). Soft-compat for `--stack`/`-s`, `OKE_STACK`,
  `.env.stack`, and `vault.fromStack` is removed — use `--docker`/`-d`,
  `OKE_DOCKER=1`, `docker/.env.docker`, and `vault.fromDocker`.
- Per-project docker stacks offset Mailpit UI (`8025`) and RustFS console
  (`9001`) host ports, so a second `oke dev -d` no longer fails with
  “port is already allocated”.
- `docker/.env.docker` and template `.env.example` files are commented and
  grouped by role (Vault vs compose services) instead of a flat dump.
- `oke dev --local` / `-l` forces laptop drivers for one session;
  `oke dev --docker` / `-d` boots compose infra with the app on host Bun.
- Bare `oke dev`: TTY prompts once (local vs docker) and saves `.oke/mode`;
  non-TTY defaults to `local` with no prompt and no save. Change the default
  with `oke mode local|docker`. A saved `docker` preference that fails to boot
  fails loudly (hint: `oke mode local`) — never silent downgrade.
- `oke upgrade` includes a codemod for the driver-map key rename
  (`dev`→`local`, `stack`→`docker`) and `fromStack`→`fromDocker`.

## v0.2.6 — 2026-07-26

### 🐛 Fixed

- npm release no longer re-enters the release script after publishing
  `okengine` (a package.json script named `publish` is an npm lifecycle hook).
  Renamed to `release`, and `npm publish` now uses `--ignore-scripts` so
  `create-oke` can publish in the same lockstep run.

## v0.2.5 — 2026-07-26

### ♻️ Changed

- Lockstep republish: npm rejected a second `okengine@0.2.4` publish, so
  `create-oke@0.2.4` never landed on npm. Bump both packages to `0.2.5` so CI
  can publish cleanly (same surface as v0.2.4).

## v0.2.4 — 2026-07-26

### ✨ Added

- `oke dev` prints colored request lines (App / Console / MCP) with flow name,
  duration, and status — gated by `OKE_DEV_REQUEST_LOG` (on by default in
  `oke dev`).
- Soft reload clears request logs and reprints the App / Console / MCP hero
  (`bun --hot --no-clear-screen`), so the banner no longer disappears on save.
- `oke dev` hero uses an OKE wordmark, profile / env / system, and the eight
  elements with active drivers; `Logs` section title; silences
  `/_oke/client.json` regen noise.
- `oke.config.ts` driver maps gain a `stack` profile for `oke dev -s` (local
  server). Boot forces `env: "stack"` under `OKE_STACK=1` so every element uses
  server drivers — not a mix of `dev`/`test` + prod store.
- `defineConfig` copies missing `stack` pins from `prod` (vault pins copy
  like every other element), so server protocols are available under `-s`
  without duplicating every map by hand.
- Durable Console sessions in `.oke/console.sqlite`, so operator login survives
  `oke dev` restarts without clearing cookies.
- `oke dev -s` warns when the `stack` driver profile still points at
  sqlite/memory while stack images run.

### ♻️ Changed

- Generated Docker artefacts default to `docker/` (`.env.stack` stays at project
  root). `oke docker --out` still overrides the directory.
- `oke dev --stack` is infra-only: compose boots role services under `docker/`
  without building/running an `app` container; the host Bun process remains the
  app with hot reload.
- Each `oke dev -s` project gets a unique compose name (`oke-dev-<hash>`) and
  host ports, so two apps no longer share one Postgres/Redis; `.env.stack`
  credentials are reused across restarts.
- `oke dev -s` stack log is a short scannable block (project, ports, drivers).
- `oke dev -s` sets `OKE_STACK=1` and binds drivers from the `stack` profile
  (compose-backed store, etc.) so local stack mimics the server, not sqlite.
- Version bump keeps `templates/*` and `examples/*` at `0.0.1` (project seed,
  not framework version).

### 🐛 Fixed

- Public Console flows ignore a stale Bearer so `setup.status` cannot 401 the
  SPA after a process restart.

## v0.2.3 — 2026-07-26

### ✨ Added

- `oke dev` probes app / Console / MCP ports and increments until free
  (Next.js-style), so a busy `:6530` no longer fails the session.
- Default Docker image pins derived from prod drivers when `images` is omitted
  (`postgres` → `postgres:18-alpine`, `redis` → `redis:8-alpine`).
- Durable Console operators under `.oke/console.sqlite` with a stable
  `.oke/console.secret`, so the claim wizard closes permanently across restarts.
- Console wordmark + favicon; site favicon resolve via `app/icon.svg`.

### ♻️ Changed

- Bare `oke` help is commands-only; Flags / JSON / exit-code notes stay on
  `--help`.
- `oke dev` extracts the Manifest from `src/` and feeds the Console on boot and
  on save, so Overview and element panels are no longer empty by default.
- Standard and full templates pin default `images` for `oke dev -s`.

### 🐛 Fixed

- Second `oke dev` run no longer reprints a claim code or leaves Console stuck
  on Loading after the first operator exists.
- Stale Console session tokens are cleared when claim is required again; setup
  status errors surface instead of spinning forever.

## v0.2.2 — 2026-07-26

### ✨ Added

- TTY `create-oke` wizard with optional `bun install` and `oke dev`, plus
  `AGENTS.md` on scaffold (`--agents-md` / `--no-agents-md`).
- Shared docs origin helper and Clack-style terminal chrome for `oke` boot
  logs and the Console claim note.
- Starter `/` welcome flows, and template README / `.gitignore` files.
- Prebuilt Console SPA ships in the published npm/JSR package.

### ♻️ Changed

- Docs links point at [okengine.vercel.app](https://okengine.vercel.app);
  site wordmark replaced with OKE logo assets.
- JSR excludes narrow to Console UI sources so `dist` ships; publish builds
  Console before packing.
- Version bump keeps `templates/*` and `examples/*` at `0.0.1` (project seed,
  not framework version). Root `CLAUDE.md` removed in favor of `AGENTS.md`.

## v0.2.1 — 2026-07-25

### 🐛 Fixed

- Docs site build in CI: remove the nested `site/bun.lock` that made Turbopack
  treat `site/app` as the project root and miss `next`, and pin
  `turbopack.root` to the monorepo root.

## v0.2.0 — 2026-07-25

### ✨ Added

- Docs site at [oke.dev](https://oke.dev) — branded landing, handbook under
  `/docs`, and a `/changelog` page derived from this file.
- Docs MCP on `:6536` with read-only `oke.docs.search` / `oke.docs.get` (Host /
  Origin validated; bodies match on-disk source with frontmatter stripped).
- Machine-readable docs surfaces: `/llms.txt`, `/llms-full.txt`, and
  `/llms.mdx/docs/...`.

### ♻️ Changed

- Console and elements handbook pages ship as MDX; content sync and the docs
  index cover both `.md` and `.mdx`.
- Publish CI triggers on version tags (`v*`) instead of pushes to `main`.
- README points at the live docs site and documents the docs MCP surface.

## v0.1.7 — 2026-07-25

### ✨ Added

- `create-oke` splits clean starters from teaching apps: `templates/*` is what a
  fresh scaffold copies, and `examples/*` stays behind `--from-example`.
- Export-size gate — the published surface is measured against `budgets.json` on
  every run, so a regression fails the build instead of shipping.

### ♻️ Changed

- Elements bind lazily, at first use, rather than at import time. Only what a
  Flow actually touches through `fx` is constructed.

## v0.1.6 — 2026-07-25

### ♻️ Changed

- Publish pipeline prepared for both npm and JSR from one release run.

### 🐛 Fixed

- `bun test` no longer walks `create-oke` templates, which are copied rather
  than executed in place.

## v0.1.4 — 2026-07-25

### ✨ Added

- Dry-run publish shortcuts, so the release path can be rehearsed without
  touching a registry.

## v0.1.3 — 2026-07-25

### ♻️ Changed

- npm and JSR publishing folded into `ci.yml` — one workflow, one gate set.

## v0.1.2 — 2026-07-25

### ♻️ Changed

- Cold-start budget raised to 75 ms, which is what a GitHub Actions runner can
  actually hold. A budget we cannot measure is not a budget.

### 🐛 Fixed

- The cold-start gate runs on a quiet runner, isolated from the parallel suite,
  so its samples measure the kernel and not the neighbours.
- Budget snapshots no longer auto-push; `budgets.json` changes land as reviewable
  commits.

## v0.1.1 — 2026-07-25

First published release. The one law is executable end to end.

### ✨ Added

- `fx`, the single door to the outside world, and the kernel that makes
  `on(Trigger) → Effects` run.
- All eight elements: Flow, Signal, Store, Clock, Gate, Vault, Channel, AI —
  with protocol-named drivers rather than vendor-named ones.
- Manifest v1: schema, validation, and diff. The AoT compiler extracts it from
  source with oxc, and Standard Schema contracts are validated ahead of time.
- Console on `:6533`, with the Flows causality view, Traces and its folded
  timeline, Runs as wide events over Parquet and DuckDB, Signals, Store, and the
  remaining element panels.
- Agent MCP surface on `:6535`.
- Typed client derived from the `App` type with zero codegen.
- `.plug()` with attachment-point scoping — app, unit, and flow.
- `oke` CLI, infrastructure derived from the Manifest, and the four reference
  apps under `examples/`.
- `create-oke` scaffold plus the release gates that guard every publish.
