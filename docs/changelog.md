# Changelog

Release history for `okengine`. One section per published tag, in reverse order.
This file is the canonical source: the site's `/changelog` page is derived from
it, so a release is only announced once it is written here.

Section headings are `## v<version> — <YYYY-MM-DD>`, and every bullet belongs to
an `### Added` / `### Changed` / `### Fixed` group.

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
- `defineConfig` copies missing `stack` pins from `prod` (vault `sops` →
  `dotenv` for `.env.stack`), so server protocols are available under `-s`
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
