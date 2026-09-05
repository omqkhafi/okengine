# OKE image pins and traps

Read from [SKILL.md](SKILL.md) when a bump looks suspicious. Update this file
when a new trap or source-of-truth path is discovered.

## Sources of truth (must stay in lockstep)

| What                    | Path                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Default role pins + proxy | `packages/create-oke/src/drivers-catalog.ts` (`DEFAULT_IMAGES`, `PROXY_IMAGES`)                                       |
| Implicit driver defaults | `src/cli/load-config.ts` (`DEFAULT_SQL_IMAGE`, `DEFAULT_PGVECTOR_IMAGE`, `DEFAULT_PGDOG_IMAGE`, `DEFAULT_KV_IMAGE`) |
| Traefik companion       | `src/docker/recipes/traefik.ts` (`SOCKET_PROXY_IMAGE`)                                                                  |

There is **no** AI engine catalog / `images.ai` role. Inference is OpenRouter,
cloud providers, or BYO `OKE_AI_URL` — not Compose pins.

## Copies to replace after the constants move

| Area       | Paths                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates  | `packages/create-oke/templates/{standard,advanced}/oke.config.ts`                                                                                                                                             |
| Keel       | `examples/keel/oke.config.ts`, `examples/keel/docker/docker-compose.yml`                                                                                                                                      |
| Tests      | `src/docker/images-config.test.ts`, `docker.test.ts`, `stack-id.test.ts`, `src/cli/load-config.images.test.ts`, `src/plugins/auth-delivery.mailpit.integration.test.ts`, `examples/keel/tests/docker.test.ts` |
| Docs       | `site/content/docs/recipes/*.mdx`, `elements/{store,channel}.mdx`, `reference/configuration.mdx`                                                                                                              |

Prefer importing catalog / recipe constants over a second string literal.

## Pin style (do not “improve”)

| Image                             | Style                          | Example              | Probe                                       |
| --------------------------------- | ------------------------------ | -------------------- | ------------------------------------------- |
| RustFS                            | exact prerelease, no `v`       | `1.0.0-rc.5`         | `rustfs/rustfs` GitHub + Hub                |
| Mailpit                           | exact patch, `v` prefix        | `v1.31.1`            | `axllent/mailpit`                           |
| PgDog                             | exact patch, `v` prefix        | `v0.1.57`            | `pgdogdev/pgdog` + `ghcr.io/pgdogdev/pgdog` |
| Meilisearch                       | **minor** (`v1.53`, not `.1`)  | `v1.53`              | `meilisearch/meilisearch` — Hub has `v1.53` |
| Traefik                           | **minor**                      | `v3.7`               | `traefik/traefik` — not `v3.7.10`           |
| nginx                             | **minor** alpine (mainline)    | `1.31-alpine`        | Hub `library/nginx`                         |
| Postgres / Redis / Caddy / Valkey | floating family                | `postgres:18-alpine` | leave                                       |
| socket-proxy                      | exact                          | `v0.5.0`             | `Tecnativa/docker-socket-proxy`             |

## Floors (never go below)

No AI-engine CVE floors — those recipes were removed. Keep other floors here when
discovered for catalog roles.

## Known traps

- **RustFS / any prerelease** — `1.0.0-rc.5-preview.*` would sort above `rc.5`.
  Skip `preview`. Stay on beta→beta or rc→rc unless the user asked to
  change channel.
- **Meilisearch** minors can need dump/restore. Note it; do not invent a
  migration tool.
- **PgDog** patch notes may flip parser defaults — mention, do not
  rewrite the recipe.
- **Matcher fixtures are not pins** — `traefik:v3.1` and
  `library/nginx:1.27` in recipe tests, Cockroach / Yugabyte / Timescale /
  Dragonfly versions in `images-config.test.ts` only prove `recipeFor()`.
  Leave them unless the user asked for vendor images.

## Channel rule

```
if current matches /-(rc|beta|alpha)/
  → newest matching channel, exclude preview
  → never replace with registry "latest" or a lower stable
```
