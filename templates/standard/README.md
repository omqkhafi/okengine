# standard

Full recommended file layout with **empty scaffolding** — structure without
business logic. Default `create-oke` template.

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
standard/
├── oke.config.ts
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

Fill `schema.ts`, then add real flows under `src/flows/<unit>/`. Prefer this
layout for new products; use `hello` / `minimal` only when you want less surface.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
