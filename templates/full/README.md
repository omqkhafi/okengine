# full

**Every element present and wired** — no business logic. Use when you want the
complete surface ready to fill in.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
```

| Port | Try |
|---|---|
| `:6530` | `GET /` · `GET /health` |
| `:6533` | Console |
| `:6535` | MCP |

## What’s in this template

```text
full/
├── oke.config.ts
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

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
