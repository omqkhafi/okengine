# CLI

Everyday `oke` commands are listed in [four-applications — Commands](./spec/four-applications.md#commands). This page covers short flags, completion, exit codes, and a few extras.

## Additional commands

```bash
oke doctor --diff                # CI gate: undeclared Manifest contract breaks
oke doctor --json                # -j  JSON on stdout; hints on stderr (agents / MCP)
oke stack --json                 # -j
oke images list                  # recipe · image · tag · digest · size (--json|-j)
oke gates list                   # Module:Action catalogue (--json|-j)
```

## Shell completion

Generated from the command registry — not a hand-maintained script:

```bash
eval "$(oke completion bash)"
eval "$(oke completion zsh)"
oke completion fish | source
```

## Short flags

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

## Exit codes

| Exit  | Meaning                               |
| ----- | ------------------------------------- |
| **0** | success                               |
| **1** | usage / validation                    |
| **2** | runtime / environment / check failure |

`oke help` prints the same flag and exit-code tables.
