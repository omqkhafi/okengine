# standard

Full recommended file layout with **empty scaffolding** — structure without
business logic. Default `create-oke` template.

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
standard/
├── .env.example               # copied to .env.local by create-oke
├── drizzle.config.ts          # oke db push|generate|migrate
├── oke.config.ts              # local: sqlite · docker/prod: postgres
├── src/
│   ├── app.ts                 # adopt({ main }); wires stores + side modules
│   ├── core.ts / schema.ts    # Store (replace the placeholder table)
│   ├── gates.ts               # Gate stubs
│   ├── vault.ts               # Vault stubs
│   ├── channels.ts            # Channel stubs
│   ├── locales/en.ts · ar.ts  # i18n stubs
│   └── flows/main/
│       ├── index.ts           # GET / · GET /health
│       ├── shapes.ts          # contracts live next to flows
│       └── signals.ts         # Signal stubs
└── tests/standard.test.ts
```

- **Elements stubbed:** Flow · Store · Signal · Gate · Vault · Channel (+ locales)
- **Unit:** `main`
- **Flows to replace:** `root`, `health` — delete or rename once your domain exists

Fill `schema.ts` (or `schema.decl.ts` + `oke db`), then add real flows under
`src/flows/<unit>/`.

## Docker mode (`oke dev --docker`)

Closest to production protocols: Postgres, Redis, SMTP (Mailpit), S3 (RustFS),
vault `sops`/age. Compose credentials land in `docker/.env.docker`.

| Surface        | URL                                              |
| -------------- | ------------------------------------------------ |
| Mailpit UI     | [http://127.0.0.1:8025](http://127.0.0.1:8025)   |
| RustFS console | [http://127.0.0.1:9001](http://127.0.0.1:9001)   |

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
