# Notes (standard)

Local-first [okengine](https://oke.omqkhafi.dev) starter: a small **Notes** API with
named Flows, Store, Signal → email, and Vault. This is a scaffold, not a finished
product — every Flow and table here is real wiring you keep or replace.

```bash
bun install
oke dev
oke db seed   # essential welcome note + local/docker sample notes
```

| Surface | URL |
| ------- | --- |
| Backend | http://127.0.0.1:6530 |
| Console | http://127.0.0.1:6533 |
| MCP | http://127.0.0.1:6535 |

## Try it

```bash
curl -s http://127.0.0.1:6530/health
curl -s -X POST http://127.0.0.1:6530/notes \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"First note"}'
curl -s http://127.0.0.1:6530/notes
```

Flow names in the `oke dev` log are stable (`main.health`, `notes.create`, …) —
never anonymous `flow_1`.

## Included vs you build

| Ships ready | You still own |
| ----------- | ------------- |
| `main.health` + notes CRUD Flows | your domain Flows and routes |
| `notes` table + `oke db seed` | schema growth and seed policy |
| `note-created` Signal → email template | delivery rules, more channels |
| `APP_WEBHOOK_SECRET` Vault contract | more secrets / `vault.config` as needed |
| `.github/workflows/ci.yml` (typecheck + test) | lint, docker, deploy when you need them |

## Layout

| Path | Role |
| ---- | ---- |
| `src/schema.decl.ts` | `notes` table |
| `src/seed/` | `oke db seed` — essential + dev sample notes |
| `src/flows/notes/` | list · create · get · archive · onCreated |
| `src/flows/main/` | root · health |
| `src/channels.ts` | `note-created` email template |
| `src/vault.ts` | `APP_WEBHOOK_SECRET` |
| `oke.config.ts` | local sqlite · docker postgres (+ redis/s3/openbao/smtp) |
| `.github/workflows/ci.yml` | `bun run typecheck` + `bun test` on push/PR |

Switch mode anytime: `oke mode docker` then `oke dev` (or `oke dev --docker`).

## AI

Not baked into this starter. Re-run create-oke with `--ai`, or `oke ai setup`, to
add `drivers.ai` + `src/ai.ts`.
