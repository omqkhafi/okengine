---
name: oke-images
description: >-
  Updates OKE Docker Compose image pins (RustFS, Mailpit, PgDog,
  Meilisearch, Traefik, nginx, and other catalog pins). Use when the
  user asks to update images, bump Docker tags, refresh Compose pins,
  upgrade RustFS / Mailpit / Meilisearch, or sync image versions across
  catalog, recipes, templates, Keel, tests, and docs. Never invents
  tags — probes registries, keeps pin style, refuses :latest. AI
  inference is not a Compose role (OpenRouter / BYO OKE_AI_URL).
---

# OKE Images — smart Compose pin updates

Run this when updating Docker image tags. Never invent versions — probe
GitHub / Docker Hub / GHCR, confirm the tag exists, then replace every
copy of the pin.

Companion to [oke-deps](../oke-deps/SKILL.md) (npm) and [oke-ship](../oke-ship/SKILL.md)
(changelog + docs). Pin styles and traps: [pins.md](pins.md).

## Catalog (defaults)

| Role            | Current source of truth                                              | Pin style        |
| --------------- | -------------------------------------------------------------------- | ---------------- |
| `store.sql`     | `postgres:18-alpine`                                                 | floating family  |
| `store.kv`      | `redis:8-alpine`                                                     | floating family  |
| `store.files`   | `rustfs/rustfs:…`                                                    | exact prerelease |
| `store.index`   | `getmeili/meilisearch:v…`                                            | minor            |
| `channel.email` | `axllent/mailpit:v…`                                                 | exact patch      |
| `pgdog`         | `ghcr.io/pgdogdev/pgdog:v…`                                          | exact patch      |
| `proxy` caddy   | `caddy:2-alpine`                                                     | floating family  |
| `proxy` traefik | `traefik:v…`                                                         | minor            |
| `proxy` nginx   | `nginx:…-alpine`                                                     | minor alpine     |
| socket-proxy    | `tecnativa/docker-socket-proxy:v…` (`src/docker/recipes/traefik.ts`) | exact            |

There is **no** `images.ai` / AI engine catalog role. Inference is OpenRouter,
cloud registry providers, or BYO OpenAI-compatible `OKE_AI_URL` / `baseUrl`.

Default when the user says “update images” / “all”: **every versioned default
pin** (not floating family tags, not test-only vendor fixtures).

## Workflow

```
Task:
- [ ] 1. Scope — which pins
- [ ] 2. Probe — latest published tag vs current (respect channel + style)
- [ ] 3. Confirm tag exists (manifest inspect)
- [ ] 4. Edit sources of truth, then replace every copy
- [ ] 5. Verify — leftover grep + targeted tests
- [ ] 6. Ship — changelog via oke-ship; update documented pins
```

### 1. Scope

| User says                                      | Do                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| “update images” / “all”                        | all versioned default pins in the catalog                          |
| named image (`rustfs`, `mailpit`, `meilisearch`) | that pin only, everywhere it appears                             |
| “AI images” / llama / Ollama / vLLM / SGLang   | **Refuse** — no Compose AI recipes; point to OpenRouter / BYO URL  |
| “vendor” / Cockroach / Yugabyte / Dragonfly    | optional recipe docs + matcher fixtures — **not** in the default   |
| “majors” / “family bump”                       | floating tags may move (`postgres:18` → `19`) — only if they asked |

Do **not** bump unrelated pins when a name is given.

### 2. Probe (smart, not blind)

Read current pins from the sources of truth (see [pins.md](pins.md)), then
query — do not guess:

```bash
# GitHub latest / recent releases
curl -sL "https://api.github.com/repos/<org>/<repo>/releases?per_page=8"

# Docker Hub tags
curl -sL "https://hub.docker.com/v2/repositories/<ns>/<name>/tags?page_size=20&name=<prefix>"
```

**Before writing**, classify each proposed bump:

| Signal                                                                     | Action                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Newer tag, same pin style and channel                                      | OK to take                                                                 |
| `:latest` / untagged `server` / `main` / `nightly`                         | **Reject**                                                                 |
| Current is `beta` / `rc`                                                   | Stay on that channel; newest **non-preview** (`rc.2` not `rc.2-preview.1`) |
| Stable `latest` older than current prerelease                              | **Reject** — keep the prerelease                                           |
| `*-rc0` / canary when a stable exists on that minor                        | Skip — take the stable                                                     |
| Floating family (`18-alpine`, `8-alpine`, `2-alpine`)                      | Leave unless user asked for a family bump                                  |
| GitHub release ahead of the registry                                       | Pin the **published image**, not the git tag                               |
| Test-only matcher (`traefik:v3.1`, `library/nginx:1.27`, Cockroach `v24…`) | Leave — not a default pin                                                  |

### 3. Confirm the tag exists

```bash
docker manifest inspect <image>:<tag>
```

Hub tags that list in the API are enough for Docker Hub. GHCR **must** pass
manifest inspect (`401` on an unauthenticated registry API is not proof).

### 4. Edit

1. Update sources of truth first (constants / `DEFAULT_IMAGES` / `PROXY_IMAGES`).
2. Prefer importing those constants over duplicating strings.
3. Replace the **old exact pin** everywhere else: templates, Keel
   `oke.config.ts` + generated `docker-compose.yml`, tests, site docs.

Do **not** change recipe env, ports, healthchecks, or entrypoints unless the
new image **requires** it — then say so in the summary.

Do **not** edit `src/console/ui-next/dist/`.

Keep pin style (see [pins.md](pins.md)): do not flip `v1.53` → `v1.53.1` or
`traefik:v3.7` → `traefik:v3.7.10` just because a patch exists.

### 5. Verify

```bash
# leftover old tags (should be empty except historical comments / matchers)
rg -n '<old-pin>' --glob '!**/ui-next/dist/**'

bun test src/docker/images-config.test.ts src/docker/docker.test.ts \
  src/docker/stack-id.test.ts src/cli/load-config.images.test.ts \
  src/cli/ai-setup/ai-setup.test.ts src/cli/docker-cli.test.ts \
  packages/create-oke/src/transform.test.ts
# keel: from examples/keel → bun test tests/docker.test.ts
```

Failures clearly from **pre-existing WIP** → note and continue. Failures from
the bump → fix or revert that pin. Do not commit unless the user asks.

### 6. Changelog + docs

Per [oke-ship](../oke-ship/SKILL.md): `## Unreleased` → `### ♻️ Changed` →
`#### Dev, Keel & create-oke` (or a flat Changed bullet if that group is
already flat). One short from→to list.

Update documented pins on the matching recipe / element / configuration
pages. Do not rewrite those pages.

Mention in the user summary when a bump has an ops caveat (Meilisearch
dump/restore across minors; PgDog parser defaults).

## Summary to the user

Short table of **from → to**, what was skipped and why (preview / unpublished
GHCR / floating / matcher), tests OK or not.

## Anti-patterns

- Pinning `:latest` or inventing unpublished tags
- Taking `*-preview.*` because it sorts higher than the RC
- “Upgrading” a floating tag to a patch (`postgres:18.3-alpine`)
- Updating only `oke.config.ts` and leaving catalog / recipes / docs stale
- Changing recipe physics (env, ports, health) during a pin bump
- Bumping test-only vendor fixtures and calling the default catalog done
- Reintroducing `images.ai` / local AI engine pins into Compose
