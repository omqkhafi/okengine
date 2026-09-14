# App (blank)

Local-first [okengine](https://oke.omqkhafi.dev) starter: Docker-first empty app with
`main.health` and Store/Vault wiring. This is a scaffold — add your domain Flows
and tables.

```bash
bun install
bun run dev       # or: bunx oke dev  — auto db push; asks once whether to seed
```

| Surface | URL |
| ------- | --- |
| Backend | http://127.0.0.1:6530 |
| Console | http://127.0.0.1:6533 |
| MCP | http://127.0.0.1:6535 |

## Try it

```bash
curl -s http://127.0.0.1:6530/health
```

Flow names in the `oke dev` log are stable (`main.health`, …) — never anonymous
`flow_1`.

## Included vs you build

| Ships ready | You still own |
| ----------- | ------------- |
| `main.health` + root welcome | your domain Flows and routes |
| empty `schema.decl` + seed stub | tables, seed policy |
| stack Vault contracts | app secrets / `vault.config` as needed |
| `.github/workflows/ci.yml` (typecheck + test) | lint, docker, deploy when you need them |

## Layout

| Path | Role |
| ---- | ---- |
| `src/app.ts` | `oke({ name, secrets })` |
| `src/core.ts` | store · vault re-exports |
| `src/vault.ts` | `APP_VAULT` contracts |
| `src/locales/` | English catalog (extra locales via `create-oke --locales`) |
| `src/db/schema.decl.ts` | domain tables (empty — add yours) |
| `src/db/seed/` | `oke db seed` stub |
| `src/db/migrations/` | versioned drizzle migrations |
| `src/flows/main/` | root · health · `shapes.ts` contracts |
| `oke.config.ts` | local env · docker postgres (+ redis/s3/smtp); vault built-in |
| `.github/workflows/ci.yml` | `bun run typecheck` + `bun test` on push/PR |

Switch mode anytime: `oke mode docker` then `oke dev` (or `oke dev --docker`).

## AI

Not baked into this starter. Re-run create-oke with `--ai`, or `oke ai setup`, to
add `drivers.ai` + models in `src/core.ts`.
