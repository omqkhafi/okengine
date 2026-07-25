---
title: "CLI Reference"
description: "oke and create-oke — everyday commands and flags."
icon: "Terminal"
source: "README.md"
---

### Commands

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
oke ai cost --since 7d           # cost per flow, per tenant, per prompt version
oke branch prod --at "yesterday" # fork journaled state into a sandbox
oke privacy erase --subject <id> # crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # run codemods for a breaking change, print the diff
```


### CLI

Everyday:

```bash
bun add okengine                 # ONE package

oke dev                          # watch · hot reload · Console :6533 · app :6530 · MCP :6535
                                 #   → also auto-syncs client types on every save
oke dev --stack                  # -s  also boot the real infra stack (generated compose)
oke dev -s store.sql,signal      #     partial: only these roles get real backends

oke start                        # runs exactly what production runs (this is the Docker CMD)
oke doctor                       # verify secrets, ports, drivers, tenancy, schema drift
oke doctor --diff                # -d  CI gate: undeclared Manifest contract breaks
oke doctor --json                # -j  JSON on stdout; hints on stderr (agents / MCP)
oke stack                        # preview resolved images/tags/ports — writes nothing
oke stack --json                 # -j
```

Schema, vault, client, Docker, build, eval, branch, privacy, upgrade:

```bash
oke schema generate              # core + plugin tables → schema/oke.ts   (--check|-c in CI)
oke vault set STRIPE_KEY         # also: list · import .env · key rotate
oke client add <url>             # types for a separate frontend repo

oke docker                       # Dockerfile + compose.store.sql.yml · compose.store.kv.yml · …
oke docker --prod                # -p  healthchecks, volumes, limits, secret refs, deploy.replicas
oke images list                  # recipe · image · tag · digest · size (--json|-j)
oke images pin                   # tags → digests in oke.images.lock

oke build --target edge          # -t  < 15 kB kernel profile
oke eval                         # run prompt eval sets; fails CI on regression
oke branch prod --at "yesterday" # -a  fork journaled state into a sandbox
oke privacy erase --subject <id> # -s  crypto-shredding: deletes the key, not the terabytes
oke upgrade                      # dry-run codemods + diff; --apply|-a to write
oke gates list                   # Module:Action catalogue (--json|-j)
```

Shell completion (generated from the command registry — not a hand-maintained script):

```bash
eval "$(oke completion bash)"
eval "$(oke completion zsh)"
oke completion fish | source
```

Long form is canonical in docs; short form is convenience only. Shared letters follow git’s pattern (different meanings on different subcommands — e.g. `-c` is `--check` on `schema generate`, `--config` on `stack` / `docker` / `images`).

| Long | Short | Where |
|------|-------|--------|
| `--stack` | `-s` | `dev` |
| `--prod` | `-p` | `docker` |
| `--port` | `-p` | `start` |
| `--check` | `-c` | `schema generate` |
| `--config` | `-c` | `stack`, `docker`, `images` |
| `--apply` | `-a` | `upgrade` |
| `--at` | `-a` | `branch` |
| `--after` | `-a` | `doctor --diff` |
| `--target` | `-t` | `build` |
| `--diff` | `-d` | `doctor` |
| `--json` | `-j` | `doctor`, `stack`, `images list`, `gates list` |
| `--manifest` | `-m` | most Manifest readers |
| `--entry` | `-e` | `dev`, `start`, `build` |
| `--out` / `--outdir` | `-o` | writers |
| `--subject` | `-s` | `privacy erase` |
| `--before` | `-b` | `doctor --diff` |
| `--base` | `-B` | `doctor --diff` |

| Exit | Meaning |
|------|---------|
| **0** | success |
| **1** | usage / validation |
| **2** | runtime / environment / check failure |

`oke help` prints the same flag and exit-code tables.

---
