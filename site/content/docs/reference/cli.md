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

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535 · docs MCP :6536
                                 #   → client types + domain schema push on save (local)
oke dev --local                  # -l  session-only local (in-memory; never writes .oke/mode)
oke dev --no-db-push             #     opt out of auto oke db push on schema input save
oke dev --docker                 # -d  infra compose under docker/ (no app container; host Bun)
                                 #     Ctrl-C / close terminal → docker compose stop (volumes kept)
oke dev -d store.sql,signal      #     partial: only these roles get real backends
oke mode local|docker            # get/set default oke dev mode (saved in .oke/mode)

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke stack                        # preview resolved images/tags/ports — writes nothing

oke schema generate              # core + plugin stubs → schema/oke.ts   (--check in CI)
oke db push                      # domain schema.ts → live local DB (dev; drizzle-kit)
oke db generate                  # versioned SQL under drizzle/ (review)
oke db migrate                   # apply migrations (explicit; never auto in prod)
oke db seed                      # defineSeed (essential + env category); never at boot
oke db seed --env prod --force   # CI: skip docker/prod confirmation prompt
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # docker/Dockerfile + docker/compose.<role>.yml · …
                                 # opt-in images.proxy → Caddyfile (caddy) or Traefik labels + socket-proxy
oke docker --prod                # app HEALTHCHECK (/_/ready), deploy (replicas · update · restart), limits, secrets
oke docker clean                 # TTY: pick oke-dev-* stacks → down -v (containers, networks, volumes)
oke docker clean --yes           # non-TTY: current project stack only
oke docker clean --all --yes     # non-TTY: every oke-dev-* stack on this machine
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke ai setup                     # configure AI driver + models (TTY wizard or flags)
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```

In development, app, Console, MCP, and docs MCP prefer the canonical ports and move upward
when occupied. Docker infrastructure uses stable per-project offsets in disjoint ranges for
each built-in service, preventing one service's offset port from overlapping another's.

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
customize. Customize asks **local** or **docker** first, walks facets for that
side only, then whether to customize the other (defaults if no). Writes
user-global `~/.oke/create-defaults.json` (reuse only when `template` matches).
Scaffold writes `.oke/mode` from the primary side. Non-TTY / `--yes` / explicit
`--template` never prompt.

### Additional commands

```bash
oke doctor --diff                # CI gate: undeclared Manifest contract breaks
oke doctor --json                # -j  JSON on stdout; hints on stderr (agents / MCP)
oke stack --json                 # -j
oke images list                  # recipe · image · tag · digest · size (--json|-j)
oke gates list                   # Module:Action catalogue (--json|-j)
oke ai setup --provider ollama --yes   # non-interactive AI config
# TTY Ollama: needs quiz → RAM-tier panel → recommend / installed / manual (+ ← Back)
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

| Long                 | Short | Where                                          |
| -------------------- | ----- | ---------------------------------------------- |
| `--local`            | `-l`  | `dev`                                          |
| `--docker`           | `-d`  | `dev`                                          |
| `--no-db-push`       |       | `dev`                                          |
| `--prod`             | `-p`  | `docker`                                       |
| `--yes`              | `-y`  | `docker clean`                                 |
| `--all`              |       | `docker clean`                                 |
| `--port`             | `-p`  | `start`                                        |
| `--check`            | `-c`  | `schema generate`                              |
| `--config`           | `-c`  | `stack`, `docker`, `images`, `db *` (drizzle)  |
| `--apply`            | `-a`  | `upgrade`                                      |
| `--at`               | `-a`  | `branch`                                       |
| `--after`            | `-a`  | `doctor --diff`                                |
| `--target`           | `-t`  | `build`                                        |
| `--diff`             |       | `doctor`                                       |
| `--json`             | `-j`  | `doctor`, `stack`, `images list`, `gates list` |
| `--manifest`         | `-m`  | most Manifest readers                          |
| `--entry`            | `-e`  | `dev`, `start`, `build`                        |
| `--out` / `--outdir` | `-o`  | writers                                        |
| `--subject`          | `-s`  | `privacy erase`                                |
| `--before`           | `-b`  | `doctor --diff`                                |
| `--base`             | `-B`  | `doctor --diff`                                |

### Exit codes

| Exit  | Meaning                               |
| ----- | ------------------------------------- |
| **0** | success                               |
| **1** | usage / validation                    |
| **2** | runtime / environment / check failure |

`oke help` prints the same flag and exit-code tables.
