# Notes (standard)

Local-first [okengine](https://oke.omqkhafi.dev) starter: a small **Notes** API with
named Flows, Store, Signal → email, and Vault.

```bash
bun install
oke dev
```

| Surface | URL |
| ------- | --- |
| App | http://127.0.0.1:6530 |
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

## Layout

| Path | Role |
| ---- | ---- |
| `src/schema.decl.ts` | `notes` table |
| `src/flows/notes/` | list · create · get · archive · onCreated |
| `src/flows/main/` | root · health |
| `src/channels.ts` | `note-created` email template |
| `src/vault.ts` | `APP_WEBHOOK_SECRET` |
| `oke.config.ts` | local sqlite · docker postgres (+ redis/s3/openbao/smtp) |

Switch mode anytime: `oke mode docker` then `oke dev` (or `oke dev --docker`).

## AI

Not baked into this starter. Re-run create-oke with `--ai`, or `oke ai setup`, to
add `drivers.ai` + `src/ai.ts`.
