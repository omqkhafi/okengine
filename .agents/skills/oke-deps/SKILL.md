---
name: oke-deps
description: >-
  Updates OKE package.json dependencies (one package, one workspace
  package.json, or all). Use when the user asks to update dependencies,
  bump deps, upgrade packages, run outdated, refresh the lockfile, or
  update root / site / create-oke / template package.json. Bun-first;
  refuses silent downgrades and protects intentional pins.
---

# OKE Deps — smart dependency updates

Run this when updating dependencies. Prefer Bun. Never invent versions —
query the registry, then edit ranges and install.

## Package map

| Target     | Path                                        | Notes                                |
| ---------- | ------------------------------------------- | ------------------------------------ |
| root       | `package.json`                              | framework + Console tooling          |
| site       | `site/package.json`                         | docs site (Next / fumadocs)          |
| create-oke | `packages/create-oke/package.json`          | scaffold CLI                         |
| template   | `packages/create-oke/template/package.json` | starter; pins `okengine` via `file:` |

Default when the user says “update dependencies” with no path: **all four**.
When they name a path or package, scope tightly.

## Workflow

```
Task:
- [ ] 1. Scope — which package.json / which packages
- [ ] 2. Probe — latest vs current (respect pins)
- [ ] 3. Edit ranges — only real upgrades
- [ ] 4. Install — bun install from repo root
- [ ] 5. Verify — lockfile + smoke (typecheck / targeted tests)
- [ ] 6. Ship — changelog via oke-ship (Unreleased); docs only if public
```

### 1. Scope

Parse the request:

| User says                                   | Do                                             |
| ------------------------------------------- | ---------------------------------------------- |
| “update dependencies” / “all”               | all four `package.json` files                  |
| path to a `package.json`                    | that file only                                 |
| package name(s) (`vite`, `next`, …)         | bump those names wherever they appear in scope |
| “root” / “site” / “create-oke” / “template” | that row in the map                            |

Do **not** bump unrelated workspace packages when a path or name is given.

### 2. Probe (smart, not blind)

For each scoped file:

```bash
bunx npm-check-updates --dep prod,dev --packageFile <path>
# preview only — add -u only after applying guardrails below
```

For a single package:

```bash
bun pm view <name> version
bun pm view <name> versions --json   # when on a prerelease / RC line
```

**Before writing**, classify each proposed bump:

| Signal                                          | Action                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Patch / minor within same major                 | OK to take                                                           |
| Major (or `0.x` → next `0.y`)                   | OK only if user asked for majors / “all latest”; note in summary     |
| Registry `latest` **older** than current pin    | **Reject** — keep current (common with RC lines)                     |
| Current is `*-rc.*` / beta / canary             | Stay on that channel; prefer newest matching RC, not stable `latest` |
| `file:`, `workspace:`, `link:`                  | Never rewrite                                                        |
| npm alias (`npm:@scope/pkg@x.y.z`)              | Bump the version **inside** the alias; keep the alias form           |
| Value is exactly `"latest"` (e.g. `@types/bun`) | Leave as `"latest"`                                                  |
| Peer ranges in root `peerDependencies`          | Widen only if the dep major truly moved and peers document it        |

Known traps (see [pins.md](pins.md)):

- **drizzle-orm / drizzle-kit** — intentional `^1.0.0-rc.*`; npm `latest` is still `0.x`. Never “upgrade” to 0.x. After install, confirm lockfile stayed on the RC (canary suffixes can drop `drizzle-kit/cli`).
- **@fumadocs/base-ui** — use the real package name with `^`, aligned with `fumadocs-core` (not a `fumadocs-ui` npm alias).
- **template `okengine`** — always `file:../..` (or whatever the template already uses).

### 3. Edit ranges

Apply accepted bumps with `ncu -u` **or** precise edits:

```bash
# all accepted in one file (after rejecting bad candidates via --reject)
bunx npm-check-updates --dep prod,dev -u --packageFile <path> --reject <comma-list>

# one package into the root workspace
bun add <name>@<version>            # dependency
bun add -d <name>@<version>         # devDependency
```

Keep range style consistent with the file (`^` vs exact vs npm alias). Do not flip `^1.0.0-rc.4` → exact unless canary resolution broke the build — then pin exact and mention it.

### 4. Install

Always from repo root (workspaces + single lockfile):

```bash
bun install
```

If install pulled an unwanted canary for a pinned RC, reinstall the exact version and ensure `bun.lock` records it.

### 5. Verify

1. `git diff -- package.json site/package.json packages/**/package.json bun.lock` — only intended bumps.
2. Smoke: `bun run typecheck` when TS/oxc/drizzle/types moved; site `types:check` when site deps moved. Failures clearly from **pre-existing WIP** → note and continue; failures from the bump → fix or revert that package.
3. Do not commit unless the user asks.

### 6. Changelog

Per [oke-ship](../oke-ship/SKILL.md): append under `## Unreleased` → `### ♻️ Changed`, short bullets (root vs site vs others).  
If the user says merge into a shipped `## v…` section, do that only when they explicitly ask.

Docs: skip unless a dependency change alters a documented install/peer story.

## Summary to the user

Keep it short: table or list of **from → to**, what was skipped and why (downgrade / pin / alias), install OK or not.

## Anti-patterns

- Running `ncu -u` on everything with no reject list
- Trusting npm `latest` over an intentional RC
- Reintroducing a `fumadocs-ui` → `@fumadocs/base-ui` npm alias
- Changing `@types/bun` from `"latest"` to a semver
- Updating only `package.json` and skipping `bun install`
- Claiming done with a red typecheck caused by the bump
