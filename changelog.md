# Changelog

Release history for `okengine`. One section per published tag, in reverse order.
This file is the canonical source: the site's `/changelog` page is derived from
it, so a release is only announced once it is written here.

Section headings are `## v<version> — <YYYY-MM-DD>`, and every bullet belongs to
an `### Added` / `### Changed` / `### Fixed` group.

## v0.3.1 — 2026-07-30

### Changed

- Docs origin cut over from `okengine.vercel.app` to
  [`oke.omqkhafi.dev`](https://oke.omqkhafi.dev). Error links, README,
  scaffold next-steps, site `metadataBase`, and `llms.txt` examples now
  point at the custom domain.

## v0.3.0 — 2026-07-30

### Added

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

### Changed

- Vault: real OpenBao is now the `docker` / `prod` default driver (durable
  single-node Raft, real init/unseal, least-privilege app token). The
  previous age-based driver and its optional peer dependency were removed
  entirely. Single-point-of-failure by design: back up
  `.oke/openbao/unseal.key` to a separate safe location — losing it means
  losing every secret permanently, with no recovery.

## v0.2.9 — 2026-07-29

### Added

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

### Changed

- Notes teaching app rewritten onto `store.resource` + `on(http.resource(…))`
  with cursor pages, multilingual search, filter/order/select, and 201/204
  status tests. Spec, Learn · Notes, Store element docs, README, and homepage
  snippet regenerated.
- Export gzip baselines refreshed for the intentional `store.resource` /
  memory-driver growth (`okengine`, `store`, `console`, `drivers`, `memory`).

### Fixed

- Latent `or(...)` silently flattening into AND in the SQL condition compiler
  (parenthesized OR groups; unsupported ops throw).
- Partial `update().set()` no longer re-applies `$defaultFn` to untouched
  columns via `prepareInsertRow`.

## v0.2.8 — 2026-07-29

### Added

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

### Changed

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

### Added

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

### Fixed

- `docker/.env.docker` is recipe-accurate: Postgres keeps USER/PASSWORD/DB;
  Redis emits PASSWORD (+ `REDIS_URL`) only; S3 uses ACCESS_KEY/SECRET_KEY/
  BUCKET (+ `S3_*` / `AWS_*` aliases and console `UI_URL`); Mailpit emits
  SMTP URL (+ `SMTP_URL`) and UI URL — no fake USER/PASSWORD/DB.

### Changed

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

### Fixed

- npm release no longer re-enters the release script after publishing
  `okengine` (a package.json script named `publish` is an npm lifecycle hook).
  Renamed to `release`, and `npm publish` now uses `--ignore-scripts` so
  `create-oke` can publish in the same lockstep run.

## v0.2.5 — 2026-07-26

### Changed

- Lockstep republish: npm rejected a second `okengine@0.2.4` publish, so
  `create-oke@0.2.4` never landed on npm. Bump both packages to `0.2.5` so CI
  can publish cleanly (same surface as v0.2.4).

## v0.2.4 — 2026-07-26

### Added

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

### Changed

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

### Fixed

- Public Console flows ignore a stale Bearer so `setup.status` cannot 401 the
  SPA after a process restart.

## v0.2.3 — 2026-07-26

### Added

- `oke dev` probes app / Console / MCP ports and increments until free
  (Next.js-style), so a busy `:6530` no longer fails the session.
- Default Docker image pins derived from prod drivers when `images` is omitted
  (`postgres` → `postgres:18-alpine`, `redis` → `redis:8-alpine`).
- Durable Console operators under `.oke/console.sqlite` with a stable
  `.oke/console.secret`, so the claim wizard closes permanently across restarts.
- Console wordmark + favicon; site favicon resolve via `app/icon.svg`.

### Changed

- Bare `oke` help is commands-only; Flags / JSON / exit-code notes stay on
  `--help`.
- `oke dev` extracts the Manifest from `src/` and feeds the Console on boot and
  on save, so Overview and element panels are no longer empty by default.
- Standard and full templates pin default `images` for `oke dev -s`.

### Fixed

- Second `oke dev` run no longer reprints a claim code or leaves Console stuck
  on Loading after the first operator exists.
- Stale Console session tokens are cleared when claim is required again; setup
  status errors surface instead of spinning forever.

## v0.2.2 — 2026-07-26

### Added

- TTY `create-oke` wizard with optional `bun install` and `oke dev`, plus
  `AGENTS.md` on scaffold (`--agents-md` / `--no-agents-md`).
- Shared docs origin helper and Clack-style terminal chrome for `oke` boot
  logs and the Console claim note.
- Starter `/` welcome flows, and template README / `.gitignore` files.
- Prebuilt Console SPA ships in the published npm/JSR package.

### Changed

- Docs links point at [okengine.vercel.app](https://okengine.vercel.app);
  site wordmark replaced with OKE logo assets.
- JSR excludes narrow to Console UI sources so `dist` ships; publish builds
  Console before packing.
- Version bump keeps `templates/*` and `examples/*` at `0.0.1` (project seed,
  not framework version). Root `CLAUDE.md` removed in favor of `AGENTS.md`.

## v0.2.1 — 2026-07-25

### Fixed

- Docs site build in CI: remove the nested `site/bun.lock` that made Turbopack
  treat `site/app` as the project root and miss `next`, and pin
  `turbopack.root` to the monorepo root.

## v0.2.0 — 2026-07-25

### Added

- Docs site at [oke.dev](https://oke.dev) — branded landing, handbook under
  `/docs`, and a `/changelog` page derived from this file.
- Docs MCP on `:6536` with read-only `oke.docs.search` / `oke.docs.get` (Host /
  Origin validated; bodies match on-disk source with frontmatter stripped).
- Machine-readable docs surfaces: `/llms.txt`, `/llms-full.txt`, and
  `/llms.mdx/docs/...`.

### Changed

- Console and elements handbook pages ship as MDX; content sync and the docs
  index cover both `.md` and `.mdx`.
- Publish CI triggers on version tags (`v*`) instead of pushes to `main`.
- README points at the live docs site and documents the docs MCP surface.

## v0.1.7 — 2026-07-25

### Added

- `create-oke` splits clean starters from teaching apps: `templates/*` is what a
  fresh scaffold copies, and `examples/*` stays behind `--from-example`.
- Export-size gate — the published surface is measured against `budgets.json` on
  every run, so a regression fails the build instead of shipping.

### Changed

- Elements bind lazily, at first use, rather than at import time. Only what a
  Flow actually touches through `fx` is constructed.

## v0.1.6 — 2026-07-25

### Changed

- Publish pipeline prepared for both npm and JSR from one release run.

### Fixed

- `bun test` no longer walks `create-oke` templates, which are copied rather
  than executed in place.

## v0.1.4 — 2026-07-25

### Added

- Dry-run publish shortcuts, so the release path can be rehearsed without
  touching a registry.

## v0.1.3 — 2026-07-25

### Changed

- npm and JSR publishing folded into `ci.yml` — one workflow, one gate set.

## v0.1.2 — 2026-07-25

### Changed

- Cold-start budget raised to 75 ms, which is what a GitHub Actions runner can
  actually hold. A budget we cannot measure is not a budget.

### Fixed

- The cold-start gate runs on a quiet runner, isolated from the parallel suite,
  so its samples measure the kernel and not the neighbours.
- Budget snapshots no longer auto-push; `budgets.json` changes land as reviewable
  commits.

## v0.1.1 — 2026-07-25

First published release. The one law is executable end to end.

### Added

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
