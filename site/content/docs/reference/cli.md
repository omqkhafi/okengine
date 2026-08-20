---
title: "CLI Reference"
description: "oke and create-oke — everyday commands and flags."
icon: "Terminal"
source: "docs/cli.md"
---

### Commands

```bash
bun add okengine                 # ONE package (project)
bun install -g okengine          # global `oke` on PATH

oke                              # interactive TUI (TTY) — Dashboard · Dev · Database · Docker · Navigator
oke --tui                        # force TUI even when other args were passed
oke --help                       # command list (also what bare `oke` prints when non-TTY / CI)

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535 · docs MCP :6536
                                 #   → always Docker Compose under docker/ + host Bun
                                 #   → client types + domain schema push on save
                                 #   → Console UI hot-reloads from source (okengine checkout; no bun run build)
oke dev --no-db-push             #     opt out of auto oke db push on schema input save
oke dev -d store.sql,signal      #     optional role filter (still Compose; requires Docker)
oke test                         # bun test with PGLite posture (NODE_ENV=test, OKE_PGLITE_URL=memory://)
                                 #   → does not start Docker Compose
oke mode                         # removed — prints error; use oke dev (Compose) / oke test (PGLite)

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke console claim-code           # print setup claim code from .oke/claim-code (after Console boot)
                                 #   → `bun run dev:console` boots kernel + Vite with a fixed
                                 #     operator (`dev@oke.dev` / `Okengine123!`) — Sign in (prefilled)
                                 #   → `bun run dev:console:seed` same + keel PM (all 8 elements) + ~80 traces
                                 #     + 500+ tasks + full CRUD / custom HTTP (GET·POST·PUT·PATCH·DELETE·HEAD·QUERY)
                                 #     + app Gate auth / oke_* system tables
                                 #     (form/github→tasks.create→notify chain, work-management
                                 #     SQL/KV/files/index; `oke_console` is Console operators);
                                 #     click Traces row → highlight chain on the radial hub;
                                 #     click a unit / element disc → 1-hop neighborhood + filter runs;
                                 #     Replay → waterfall playhead + chain pulse on the graph)
                                 #   → `bun run dev:console:fresh` / `:fresh:seed` — claim from scratch
                                 #     (no fixed operator; claim code printed in the boot log)
                                 #   → after `bun run test:console:setup`, open the HTML report:
                                 #     `bun run test:console:setup:report` (trace + screenshots + video)
oke stack                        # preview resolved images/tags/ports — writes nothing

oke schema generate              # core + plugin stubs → .oke/schema/oke.ts (--check in CI)
oke db push                      # domain schema.ts → live DB (dev; drizzle-kit)
oke db generate                  # versioned SQL under drizzle/ (review)
oke db migrate                   # apply migrations (explicit; never auto in prod)
oke db seed                      # this app's defineSeed (name + essential + env) — standard CLI path
oke db seed --env prod --force   # CI: skip prod confirmation prompt
oke db studio                    # drizzle-kit Studio (long-running)
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # docker/Dockerfile + docker-compose.yml (prod-grade; 4 CPU / 8 GiB budget)
oke docker --split               # layered compose.yml + compose.<role>.yml + compose.prod.yml
oke docker --stack               # docker-stack.yml for docker stack deploy
oke docker --cpus 8 --memory 16  # override host budget used for deploy.resources
oke docker --no-prod             # skip readiness / deploy / resource budget
oke docker clean                 # TTY: pick oke-dev-* projects → down -v (containers, networks, volumes)
oke docker clean --yes           # non-TTY: current project only
oke docker clean --all --yes     # non-TTY: every oke-dev-* project on this machine
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke ai setup                     # configure AI driver + models (TTY wizard or flags)
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke replay --request-id <id>     # re-invoke a past Flow from a Runs WideEvent (dry-run if send/ask)
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```

`oke replay` loads a Runs WideEvent by id and re-enters the Flow with stored
input. Defaults to dry-run when the ledger has `send` / `ask` (pass `--live`
to override). Needs a build that persisted `WideEvent.input`. Console Traces
Replay (`POST /console/traces/replay`) uses the same `runReplay` path.

`oke dev` request lines print the WideEvent / run id after the timestamp.
Paste it into Traces or `oke replay --request-id`.

`oke dev` bridges host-app WideEvents into Console Traces: the CLI starts
Console first, mints a loopback ingest secret, and sets `OKE_RUNS_INGEST_URL` /
`OKE_RUNS_INGEST_SECRET` on the host child so every recorded run POSTs to
`POST /console/runs/ingest`. Console appends into its own runs store (live
`feedRun` → PII-masked `projectRun` for `GET /console/runs` and
`/console/live`). `listRuns` also reads host Parquet at `.oke/runs`, so
Traces survive a Console restart. Production recording stays opt-in —
`oke start` does not enable the bridge; set `oke({ runs })` or
`drivers.runs` explicitly. `oke replay` reads the same `.oke/runs` tree.

In development, app, Console, MCP, and docs MCP prefer the canonical ports and move upward
when occupied. Docker infrastructure uses stable per-project offsets in disjoint ranges for
each built-in service, preventing one service's offset port from overlapping another's.

Bare `oke` on a TTY opens an Ink interactive shell (optional deps `ink` +
`react`). The viewport is cleared before render so boot logs never sit above the
frame. Chrome matches `oke dev`: green OKE wordmark on Dashboard, green active
tabs, cyan focus rows. Panels cover live ports (App / Console / MCP / Docs MCP),
Dev start/stop/attach with live logs, Database action cards (including Studio),
Docker compose status, and a Manifest navigator. **Tab** / **←→** (on the tab
strip) switch panels; **↑↓** navigate inside a panel; **Esc** returns to the tab
strip, then confirms quit when a managed `oke dev` is running; **1–5** jump
panels from any focus. Press `/` for the **command palette** (Tab autofill,
Enter runs `oke …`; status shows in the global footer). If `oke dev` is already
running, the TUI shows **Connected** via `.oke/dev.json` + port probes and will
not spawn a second stack. Non-TTY / CI keeps the classic help listing
(`EXIT_USAGE`).

`oke dev` always starts Compose (requires a running Docker daemon). Boot chrome
prints immediately (wordmark + Starting + profile), then streams background work
(compose up, vault, per-service health, AI probe). Status ● is green ready ·
yellow pending/loading · red error · dim idle. Compose health keeps polling
(`docker compose ps -a`); AI ● tracks model phase while the AI container is up.
Boot does not wait for the model to become ready. A successful session writes
`.oke/dev.json` (pid · ports · startedAt) and clears it on stop. Durable local
markers live in `.oke/state.json` — not in the session lock. Console session signing uses
`.oke/console.secret` (or `OKE_CONSOLE_SECRET`); that is not a Vault secret.

On a TTY, Ink keyboard controls stay active after boot (`useInput` — same
shortcuts as before). Press `r` to clear the log pane and reprint the latest
board.

| Key       | Action                              |
| --------- | ----------------------------------- |
| `?`       | help                                |
| `r`       | refresh — clear logs, show latest ● |
| `s`       | `oke db seed`                       |
| `q`       | quit `oke dev`                      |
| `u` / `x` | compose up / stop (whole stack)     |

Compose stays quiet unless it fails. Process-local boot notices print once under
the hero (not once per process).

`oke test` sets `NODE_ENV=test` and `OKE_PGLITE_URL=memory://` when unset, checks
that `@electric-sql/pglite` resolves, then forwards argv to `bun test`.

`oke mode` and `oke dev --local` / `-l` are removed — they exit with an error.
See [Migrating environments](/docs/reference/migrating-environments).

### create-oke

```bash
bunx create-oke@latest my-app                    # TTY: template → recommended / reuse / customize
bunx create-oke@latest my-app --template advanced
bunx create-oke@latest my-app --yes              # non-interactive recommended defaults
bunx create-oke@latest my-app --sql postgres
bunx create-oke@latest my-app --ai               # AI model wizard before install
bunx create-oke@latest my-app --no-ai
```

On a TTY: pick **standard** or **advanced**, then recommended defaults or
customize. Customize walks **Docker-first** facets once (including `store.index`
with a `none` opt-out), then **AI setup**: Recommended (llama.cpp) · Customize ·
Off. Writes user-global `~/.oke/create-defaults.json` (reuse only when `template`
matches). Recommended / customize also ask locales, PgDog, and reverse proxy
(Caddy / Traefik / nginx / No); **reuse** applies the saved answers without
re-asking. Flags: `--locales`, `--pgdog` / `--no-pgdog`, `--proxy` /
`--no-proxy`. Non-TTY / `--yes` / explicit `--template` never prompt.

### Additional commands

```bash
oke doctor --diff                # CI gate: undeclared Manifest contract breaks
oke doctor --json                # -j  JSON on stdout; hints on stderr (agents / MCP)
oke stack --json                 # -j
oke images list                  # recipe · image · tag · digest · size (--json|-j)
oke gates list                   # Module:Action catalogue (--json|-j)
oke console claim-code           # first-admin claim from .oke/claim-code (--json|-j)
oke ai setup --provider llama-cpp --yes  # default local AI
oke ai setup --provider ollama --yes     # fully supported alternative
# TTY: llama.cpp / Ollama → banner · tiers · manual; vLLM / SGLang / cloud → model
```

### Shell completion

Generated from the command registry — not a hand-maintained script:

```bash
eval "$(oke completion bash)"
eval "$(oke completion zsh)"
oke completion fish | source
```

### Short flags

Long form is canonical in docs; short form is convenience only. Shared letters follow git’s pattern (different meanings on different subcommands — e.g. `-c` is `--check` on `schema generate`, `--config` on `stack` / `docker` / `images`).

| Long                 | Short | Where                                                                |
| -------------------- | ----- | -------------------------------------------------------------------- |
| `--docker`           | `-d`  | `dev` (optional Compose **role filter**)                             |
| `--no-db-push`       |       | `dev`                                                                |
| `--prod`             | `-p`  | `docker`                                                             |
| `--yes`              | `-y`  | `docker clean`                                                       |
| `--all`              |       | `docker clean`                                                       |
| `--port`             | `-p`  | `start`                                                              |
| `--check`            | `-c`  | `schema generate`                                                    |
| `--config`           | `-c`  | `stack`, `docker`, `images`, `db *` (drizzle)                        |
| `--apply`            | `-a`  | `upgrade`                                                            |
| `--at`               | `-a`  | `branch`                                                             |
| `--after`            | `-a`  | `doctor --diff`                                                      |
| `--target`           | `-t`  | `build`                                                              |
| `--diff`             |       | `doctor`                                                             |
| `--json`             | `-j`  | `doctor`, `stack`, `images list`, `gates list`, `console claim-code` |
| `--manifest`         | `-m`  | most Manifest readers                                                |
| `--entry`            | `-e`  | `dev`, `start`, `build`, `replay`                                    |
| `--request-id`       | `-r`  | `replay`                                                             |
| `--dry-run`          |       | `replay`                                                             |
| `--live`             |       | `replay`                                                             |
| `--out` / `--outdir` | `-o`  | writers                                                              |
| `--subject`          | `-s`  | `privacy erase`                                                      |
| `--before`           | `-b`  | `doctor --diff`                                                      |
| `--base`             | `-B`  | `doctor --diff`                                                      |
| `--env`              |       | `db *` (`dev` \| `test` \| `prod`)                                   |
| `--force`            |       | `db seed`                                                            |
| `--local` / `-l`     |       | **removed** on `dev` (use `oke test`)                                |

### Exit codes

| Exit  | Meaning                               |
| ----- | ------------------------------------- |
| **0** | success                               |
| **1** | usage / validation                    |
| **2** | runtime / environment / check failure |

`oke help` prints the same flag and exit-code tables.
