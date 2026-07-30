# standard

Full recommended file layout with **empty scaffolding** — structure without
business logic. Default `create-oke` template.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # postgres · redis · Mailpit · RustFS · OpenBao
```

Local `oke dev` auto-runs `oke db push` when `schema.decl.ts` changes (opt out:
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
│   ├── core.ts / schema.decl.ts  # Store (replace the placeholder table)
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

Fill `schema.decl.ts` (abstract tables → `oke db` emits `schema.generated.ts`
for the active dialect), then add real flows under
`src/flows/<unit>/`.

## Docker mode (`oke dev --docker`)

Closest to production protocols: Postgres, Redis, SMTP (Mailpit), S3 (RustFS),
and a real OpenBao vault (durable Raft storage, real init/unseal — not a
`-dev` server). Compose credentials land in `docker/.env.docker`.

On first `oke dev --docker` / `oke docker --prod` bring-up, `oke` initializes
OpenBao, unseals it, and mints a least-privilege token for the app. The root
token and the single unseal key stay on the host under `.oke/openbao/`
(`0600`, gitignored) — never in `docker/.env.docker`, never in YAML.

> **Single point of failure by design:** back up `.oke/openbao/unseal.key` to
> a separate safe location. Losing it means losing every secret permanently,
> with no recovery.

Host ports are unique per project so multiple apps can run at once. Use
`oke stack` or the `oke dev` Docker summary for the Mailpit UI and RustFS
console URLs — do not assume `:8025` / `:9001`.

`docker/.env.docker` uses protocol-native keys (`DATABASE_URL`, `REDIS_URL`,
`S3_*`, `SMTP_*`, `MAILPIT_UI_URL`) and includes commented optional controls.
Supported controls you uncomment are preserved when the generated stack refreshes.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
