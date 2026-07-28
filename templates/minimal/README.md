# minimal

Smallest shape you’d actually ship — **Store + HTTP flows** over a single table.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # postgres via compose
```

Local `oke dev` auto-runs `oke db push` when `schema.ts` changes (opt out:
`--no-db-push`). Docker/prod never auto-apply DDL — use `oke db migrate`.

| Port    | Try                                         |
| ------- | ------------------------------------------- |
| `:6530` | `GET /` · `GET /entries` · `POST /entries` |
| `:6533` | Console                                     |
| `:6535` | MCP                                         |

## What’s in this template

```text
minimal/
├── .env.example               # copied to .env.local by create-oke
├── drizzle.config.ts          # oke db push|generate|migrate
├── oke.config.ts              # local: sqlite · docker/prod: postgres
├── src/
│   ├── app.ts                 # adopt({ main }), stores: [db]
│   ├── core.ts                # store.sql("…")
│   ├── schema.ts              # entries table (Drizzle escape hatch)
│   └── flows/main/index.ts    # GET / · GET|POST /entries
└── tests/minimal.test.ts
```

- **Elements:** Flow · Store (`sql`)
- **Unit:** `main`
- **Flows:** `root`, `list` (`GET /entries`), `create` (`POST /entries` with `{ body }`)
- **Schema:** `entries` — `id`, `body`, `createdAt`

Swap `entries` for your domain table and grow flows beside it. Prefer
`store.schema.table` + `field.*` in `schema.decl.ts` when you want ORM-agnostic
declare (Linkly); hand-written `schema.ts` remains the escape hatch. Need gates,
channels, or locales? Use `standard`.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
