# full

Everything in **standard**, plus a real **AI** prompt on the mock driver — still
domain-neutral. Use when you want the complete surface with behaviour on day one.

## First five minutes

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # postgres · redis · Mailpit · RustFS · sops
```

1. Open the Console at [http://127.0.0.1:6533](http://127.0.0.1:6533) — claim it if prompted.
2. Create one ping (same chain as `standard`):

   ```bash
   curl -s -X POST http://127.0.0.1:6530/pings \
     -H 'content-type: application/json' \
     -d '{"note":"hello"}'
   ```

3. Trigger AI from the Console **Flows** panel — invoke `main.echo` with
   `{ "text": "hi" }` — or:

   ```bash
   curl -s -X POST http://127.0.0.1:6530/echo \
     -H 'content-type: application/json' \
     -d '{"text":"hi"}'
   ```

4. Watch the Console panels populate:

   | Panel | What you should see |
   |---|---|
   | **Flows** | ping flows + `main.echo` |
   | **Signals** | `pinged` |
   | **Store** | `pings` row |
   | **Clock** | cron `1h` |
   | **Gates** | `fair` · `cheap` · `exact` · `burst` (composed per route) |
   | **Vault** | `APP_SECRET` — fingerprint from scaffolded `.env.local` (copied from `.env.example`) |
   | **Channels** | `ping-notice` (+ inbox after ping) |
   | **AI / Runs / Traces** | the `echo` prompt ask from step 3 |

## What’s wired

```text
POST /pings  →  insert · vault · emit(pinged) → channel send
POST /echo   →  fx.ask(echo) via ai.model("mock")
every("1h")  →  prune old pings
```

```text
full/
├── oke.config.ts              # ai.dev = mock
├── src/
│   ├── app.ts                 # gates, secrets, signals, stores, channel, ai
│   ├── core.ts / schema.ts
│   ├── gates.ts · vault.ts · channels.ts · ai.ts
│   ├── locales/en.ts · ar.ts
│   └── flows/main/
│       ├── index.ts           # + main.echo
│       ├── shapes.ts
│       └── signals.ts
└── tests/full.test.ts
```

Prefer `standard` if you do not need AI on day one.

## Docker mode (`oke dev --docker`)

Closest to production protocols: Postgres, Redis, SMTP (Mailpit), S3 (RustFS),
vault `sops`/age. First docker boot scaffolds `AGE_SECRET_KEY` in `.env.local`
(gitignored) and `secrets.enc.json` (committable ciphertext).

| Surface | URL |
|---|---|
| Mailpit UI | [http://127.0.0.1:8025](http://127.0.0.1:8025) |
| RustFS console | [http://127.0.0.1:9001](http://127.0.0.1:9001) |

SMS / WhatsApp are not pinned by default — declare the medium in code and add a
driver pin in `oke.config.ts` when you need them.

## Deploy (staging / production)

Protocols come from `oke.config.ts` (`drivers.*.prod`). Connection values come
from the host env panel (`DATABASE_URL`, `REDIS_URL`, plus names in
`src/vault.ts` such as `APP_SECRET`). Staging is a **second deploy** of the same
app — not a fifth key in the driver map.

```bash
oke docker --prod   # docker/Dockerfile + compose layers (no secrets in YAML)
oke start           # production entry (Docker CMD)
```

`.env.example` documents the variables; handbook: **Get Started → Deploy**.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
