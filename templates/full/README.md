# full

**Every element present and wired** — no business logic. Use when you want the
complete surface ready to fill in.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # postgres · redis · Mailpit · RustFS · sops
```

Local `oke dev` auto-runs `oke db push` when `schema.ts` changes (opt out:
`--no-db-push`). Docker/prod never auto-apply DDL — use `oke db migrate`.

| Port    | Try                       |
| ------- | ------------------------- |
| `:6530` | `GET /` · `GET /health`   |
| `:6533` | Console                   |
| `:6535` | MCP                       |

## What’s in this template

```text
full/
├── .env.example               # copied to .env.local by create-oke
├── drizzle.config.ts          # oke db push|generate|migrate
├── oke.config.ts              # local: sqlite · docker/prod: postgres
├── src/
│   ├── app.ts                 # gates, secrets, signals, stores, channel, ai
│   ├── core.ts / schema.ts    # Store
│   ├── gates.ts               # open gate (used on HTTP)
│   ├── vault.ts               # appSecret
│   ├── channels.ts            # welcome template
│   ├── ai.ts                  # stub model + echo prompt
│   ├── locales/en.ts · ar.ts
│   └── flows/main/
│       ├── index.ts           # GET / · GET /health · every("1d")
│       ├── shapes.ts
│       └── signals.ts         # pinged
└── tests/full.test.ts
```

- **Elements wired:** Flow · Store · Signal · Clock (`every`) · Gate · Vault · Channel · AI
- **Unit:** `main`
- **App `$options`:** `gates`, `secrets`, `signals`, `stores`, `channel`, `ai`
- **Flows:** `root`, `health` (emits `pinged`), plus a trivial daily cron

Replace stubs with real models, prompts, channels, and domain flows. Prefer
`standard` if you do not need AI / clock / vault on day one.

## Docker mode (`oke dev --docker`)

Closest to production protocols: Postgres, Redis, SMTP (Mailpit), S3 (RustFS),
vault `sops`/age. Compose credentials land in `docker/.env.docker`.

| Surface        | URL                                              |
| -------------- | ------------------------------------------------ |
| Mailpit UI     | [http://127.0.0.1:8025](http://127.0.0.1:8025)   |
| RustFS console | [http://127.0.0.1:9001](http://127.0.0.1:9001)   |

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
