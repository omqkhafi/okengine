# Keel

Linear-shaped project-management example for okengine. Same domain vocabulary as
the Console seed (`keel`, teams, issues, cycles) — a real app, not a create-oke
template. `oke dev` attaches Console to Compose: Postgres, Redis, RustFS,
Mailpit, and Meilisearch.

GitHub and Slack ingest are stubs. They read vault contracts and create issues
from the payload. No outbound HTTP.

## Run

From the repo root:

```bash
bun run dev:keel
```

Or inside this directory:

```bash
bun run dev          # oke dev → Compose + app :6530 + Console :6533
oke db seed          # featured story (ENG / DES / SUP, Aria/Ben, ENG-184)
```

Seed is the featured story only — not the Console’s generated issue volume.

Dev vault fallbacks in `src/core.ts` let Docker boot without real keys. Copy
`.env.example` to `.env.local` only when you want to override them.

## Tests

```bash
bun test             # createTestApp + docker derive
OKE_TEST_DOCKER=1 bun test   # also live `docker compose config` when a daemon is up
```

In-tree `oke test` (not the root `bun test` suite — `examples/**` is ignored
there). CI runs `bun run --cwd examples/keel test`.
