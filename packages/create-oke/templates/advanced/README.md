# Notes (advanced)

Docker-ready [okengine](https://oke.omqkhafi.dev) **Notes** starter — same domain as
`standard`, plus files attach, a daily digest clock, and an AI summarize stub.
Scaffold, not a finished product: keep the Flows you want, replace the rest.

```bash
bun install
oke mode docker   # seeded by create-oke recommended path
oke dev           # auto db push; asks once whether to seed
```

| Surface | URL |
| ------- | --- |
| App | http://127.0.0.1:6530 |
| Console | http://127.0.0.1:6533 |
| MCP | http://127.0.0.1:6535 |

## Extra routes (vs standard)

| Method | Path | Flow |
| ------ | ---- | ---- |
| POST | `/notes/:id/attach` | `notes.attach` — text blob in `files:uploads` |
| POST | `/notes/:id/summarize` | `notes.summarize` — `fx.ask` when AI is configured |
| clock | `every("1d")` | `notes.digest` — active note count |

Configure AI with `oke ai setup` or `create-oke --ai` (writes `src/core/ai.ts` + `drivers.ai`).
Without AI, summarize returns a local excerpt (`via: "fallback"`).

## Included vs you build

| Ships ready | You still own |
| ----------- | ------------- |
| standard Notes surface + attach / digest / summarize | your domain beyond notes |
| files Store pin + digest Clock | production file policy and schedules |
| AI summarize stub (fallback without AI) | real prompts / models via `oke ai setup` |
| `.github/workflows/ci.yml` (typecheck + test) | lint, docker, deploy when you need them |

## Layout extras

| Path | Role |
| ---- | ---- |
| `src/core/` | `store` (db + files) · gates · vault · channels |
| `src/db/` | schema · seed · migrations |
| `.github/workflows/ci.yml` | `bun run typecheck` + `bun test` on push/PR |

## Drivers

See `oke.config.ts`: local env/memory/fs · docker postgres/redis/s3/smtp; vault built-in.
Optional Meilisearch index pin is commented — enable via create-oke customize.
