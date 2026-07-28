# standard

Default `create-oke` template — a tiny **ping** unit that is real on first boot,
not empty stubs. Domain-neutral so you replace it with your product.

## First five minutes

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # postgres · redis · Mailpit · RustFS · sops
```

1. Open the Console at [http://127.0.0.1:6533](http://127.0.0.1:6533) — claim it if prompted.
2. In another terminal, create one ping:

   ```bash
   curl -s -X POST http://127.0.0.1:6530/pings \
     -H 'content-type: application/json' \
     -d '{"note":"hello"}'
   ```

3. Watch the Console panels populate (not empty states):

   | Panel | What you should see |
   |---|---|
   | **Flows** | `main.create`, `main.list`, `main.health`, `main.root`, plus the signal + cron flows |
   | **Signals** | `pinged` (emitted by create) |
   | **Store** | `sql:app` → table `pings` with your row |
   | **Clock** | cron `1h` (prunes old pings) |
   | **Gates** | `fair` · `cheap` · `exact` · `burst` (composed per route) |
   | **Vault** | `APP_SECRET` — fingerprint from scaffolded `.env.local` (copied from `.env.example`) |
   | **Channels** | template `ping-notice` — and a send in the dev inbox after the ping |

4. Read it back:

   ```bash
   curl -s http://127.0.0.1:6530/pings
   ```

## What’s wired

```text
POST /pings  →  insert pings  →  fx.vault(APP_SECRET)  →  emit(pinged)
on(pinged)   →  fx.send(ping-notice)   # console driver inbox
every("1h")  →  delete old pings
GET  /pings  →  select pings
```

```text
standard/
├── oke.config.ts
├── src/
│   ├── app.ts                 # gates, secrets, signals, stores, channel
│   ├── core.ts / schema.ts    # Store — real `pings` table
│   ├── gates.ts               # fair · cheap · exact · burst
│   ├── vault.ts               # APP_SECRET + dev fallback
│   ├── channels.ts            # ping-notice template
│   ├── locales/en.ts · ar.ts
│   └── flows/main/
│       ├── index.ts           # root · health · create · list · signal · cron
│       ├── shapes.ts
│       └── signals.ts         # pinged
└── tests/standard.test.ts
```

Replace `pings` / `pinged` / `ping-notice` with your domain. Prefer this layout for
new products; use `hello` / `minimal` only when you want less surface.

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
