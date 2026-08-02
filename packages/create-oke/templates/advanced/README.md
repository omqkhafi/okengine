# Notes (advanced)

Docker-ready [okengine](https://oke.omqkhafi.dev) **Notes** starter — same domain as
`standard`, plus files attach, a daily digest clock, and an AI summarize stub.

```bash
bun install
oke mode docker   # seeded by create-oke recommended path
oke dev
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

Configure AI with `oke ai setup` or `create-oke --ai` (writes `src/ai.ts` + `drivers.ai`).
Without AI, summarize returns a local excerpt (`via: "fallback"`).

## Drivers

See `oke.config.ts`: local sqlite/memory/fs · docker postgres/redis/s3/openbao/smtp.
Optional Meilisearch index pin is commented — enable via create-oke customize.
