---
title: "CLI Reference"
description: "oke and create-oke — everyday commands and flags."
icon: "Terminal"
source: "docs/cli.md"
---

### Commands

```bash
bun add okengine                 # ONE package

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535
                                 #   → client types + domain schema push on save (local)
oke dev --local                  # -l  session-only local (in-memory; never writes .oke/mode)
oke dev --no-db-push             #     opt out of auto oke db push on schema change
oke dev --docker                 # -d  infra compose under docker/ (no app container; host Bun)
oke dev -d store.sql,signal      #     partial: only these roles get real backends
oke mode local|docker            # get/set default oke dev mode (saved in .oke/mode)

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke stack                        # preview resolved images/tags/ports — writes nothing

oke schema generate              # core + plugin stubs → schema/oke.ts   (--check in CI)
oke db push                      # domain schema.ts → live local DB (dev; drizzle-kit)
oke db generate                  # versioned SQL under drizzle/ (review)
oke db migrate                   # apply migrations (explicit; never auto in prod)
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # docker/Dockerfile + docker/compose.<role>.yml · …
oke docker --prod                # healthchecks, volumes, limits, secret refs, deploy.replicas
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```

In development, app, Console, and MCP prefer the canonical ports and move upward when
occupied. Docker infrastructure uses stable per-project offsets in disjoint ranges for
each built-in service, preventing one service's offset port from overlapping another's.

### Additional commands

```bash
oke doctor --diff                # CI gate: undeclared Manifest contract breaks
oke doctor --json                # -j  JSON on stdout; hints on stderr (agents / MCP)
oke stack --json                 # -j
oke images list                  # recipe · image · tag · digest · size (--json|-j)
oke gates list                   # Module:Action catalogue (--json|-j)
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
