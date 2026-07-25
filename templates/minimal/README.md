# minimal

Smallest shape you’d actually ship — **Store + HTTP flows** over a single table.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
```

| Port | Try |
|---|---|
| `:6530` | `GET /` · `GET /entries` · `POST /entries` |
| `:6533` | Console |
| `:6535` | MCP |

## What’s in this template

```text
minimal/
├── oke.config.ts
├── src/
│   ├── app.ts                 # adopt({ main }), stores: [db]
│   ├── core.ts                # store.sql("…")
│   ├── schema.ts              # entries table (Drizzle)
│   └── flows/main/index.ts    # GET / · GET|POST /entries
└── tests/minimal.test.ts
```

- **Elements:** Flow · Store (`sql`)
- **Unit:** `main`
- **Flows:** `root`, `list` (`GET /entries`), `create` (`POST /entries` with `{ body }`)
- **Schema:** `entries` — `id`, `body`, `createdAt`

Swap `entries` for your domain table and grow flows beside it. Need gates,
channels, or locales? Use `standard`.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
