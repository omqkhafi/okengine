# OKE image pins and traps

Read from [SKILL.md](SKILL.md) when a bump looks suspicious. Update this file
when a new trap or source-of-truth path is discovered.

## Sources of truth (must stay in lockstep)

| What                           | Path                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default role pins + AI + proxy | `packages/create-oke/src/drivers-catalog.ts` (`DEFAULT_IMAGES`, `PROXY_IMAGES`, `LLAMA_CPP_IMAGE`, `OLLAMA_IMAGE`, `VLLM_IMAGE`, `SGLANG_IMAGE`) |
| AI recipe constants            | `src/docker/recipes/llama-cpp.ts`, `ollama.ts`, `vllm.ts`, `sglang.ts` (comment: must match catalog)                                             |
| Implicit driver defaults       | `src/cli/load-config.ts` (`DEFAULT_SQL_IMAGE`, `DEFAULT_PGVECTOR_IMAGE`, `DEFAULT_PGDOG_IMAGE`, `DEFAULT_KV_IMAGE`)                              |
| Traefik companion              | `src/docker/recipes/traefik.ts` (`SOCKET_PROXY_IMAGE`)                                                                                           |

## Copies to replace after the constants move

| Area       | Paths                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates  | `packages/create-oke/templates/{standard,advanced}/oke.config.ts`                                                                                                                                             |
| Keel       | `examples/keel/oke.config.ts`, `examples/keel/docker/docker-compose.yml`                                                                                                                                      |
| create-oke | `packages/create-oke/src/ai-setup/from-pref.ts`, `prompts.ts`, `transform.test.ts`                                                                                                                            |
| CLI AI     | `src/cli/ai-setup/index.ts`, `prompts.ts`, `ai-setup.test.ts`                                                                                                                                                 |
| Tests      | `src/docker/images-config.test.ts`, `docker.test.ts`, `stack-id.test.ts`, `src/cli/load-config.images.test.ts`, `src/plugins/auth-delivery.mailpit.integration.test.ts`, `examples/keel/tests/docker.test.ts` |
| Docs       | `site/content/docs/recipes/*.mdx`, `elements/{store,ai,channel}.mdx`, `reference/configuration.mdx`                                                                                                          |

Prefer importing catalog / recipe constants over a second string literal.

## Pin style (do not “improve”)

| Image                             | Style                          | Example              | Probe                                       |
| --------------------------------- | ------------------------------ | -------------------- | ------------------------------------------- |
| RustFS                            | exact prerelease, no `v`       | `1.0.0-rc.2`         | `rustfs/rustfs` GitHub + Hub                |
| Mailpit                           | exact patch, `v` prefix        | `v1.30.7`            | `axllent/mailpit`                           |
| PgDog                             | exact patch, `v` prefix        | `v0.1.53`            | `pgdogdev/pgdog` + `ghcr.io/pgdogdev/pgdog` |
| Meilisearch                       | **minor** (`v1.53`, not `.1`)  | `v1.53`              | `meilisearch/meilisearch` — Hub has `v1.53` |
| llama.cpp                         | exact **published** GHCR build | `server-b10450`      | GitHub `bNNNN` then manifest inspect        |
| Ollama                            | exact patch, **no** `v`        | `0.32.13`            | `ollama/ollama` — Hub tag ≠ `v0.32.13`      |
| vLLM                              | exact, `v` prefix              | `v0.27.1`            | `vllm-project/vllm` + `vllm/vllm-openai`    |
| SGLang                            | exact + `-runtime`             | `v0.5.17-runtime`    | `sgl-project/sglang` + `lmsysorg/sglang`    |
| Traefik                           | **minor**                      | `v3.7`               | `traefik/traefik` — not `v3.7.10`           |
| nginx                             | **minor** alpine (mainline)    | `1.31-alpine`        | Hub `library/nginx`                         |
| Postgres / Redis / Caddy / Valkey | floating family                | `postgres:18-alpine` | leave                                       |
| socket-proxy                      | exact                          | `v0.5.0`             | `Tecnativa/docker-socket-proxy`             |

## Floors (never go below)

| Image     | Floor      | Why                                           |
| --------- | ---------- | --------------------------------------------- |
| llama.cpp | build 8146 | GGUF parser CVEs (`LLAMA_CPP_MIN_SAFE_BUILD`) |
| Ollama    | `0.17.1`   | CVE-2026-7482                                 |

## Known traps

- **llama.cpp GHCR lag** — `releases/latest` can be `b10453` while
  `server-b10450` is the newest image. Unpublished `server-b*` →
  `docker manifest inspect` = `manifest unknown`.
- **RustFS / any prerelease** — `1.0.0-rc.2-preview.1` sorts above `rc.2`.
  Skip `preview`. Stay on beta→beta or rc→rc unless the user asked to
  change channel.
- **Ollama Docker tags** omit `v`. GitHub is `v0.32.13`; image is
  `ollama/ollama:0.32.13`.
- **SGLang** default pin is the `-runtime` tag, not bare `v0.5.17`.
- **Meilisearch** minors can need dump/restore. Note it; do not invent a
  migration tool.
- **PgDog** patch notes may flip parser defaults — mention, do not
  rewrite the recipe.
- **Matcher fixtures are not pins** — `traefik:v3.1` and
  `library/nginx:1.27` in recipe tests, Cockroach / Yugabyte / Timescale /
  Dragonfly versions in `images-config.test.ts` only prove `recipeFor()`.
  Leave them unless the user asked for vendor images.
- **Historical comments** — `b10290+` in the llama.cpp recipe/docs names
  when a bug started. Do not rewrite those to the new pin.

## Channel rule

```
if current matches /-(rc|beta|alpha)/
  → newest matching channel, exclude preview
  → never replace with registry "latest" or a lower stable
```
