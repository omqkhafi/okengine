# src/bench/ — System Load Harness (15 Groups)

Reusable load-test harness modeled on `src/kernel/horizontal-child.ts` +
`horizontal.integration.test.ts`. One full-featured app child
(`load-app.ts` / `load-child.ts`) serves all bench routes; one `.bench.ts`
file per group emits a disclaimer-stamped JSON artifact into
`src/bench/results/` (gitignored).

> **Disclaimer (applies to every artifact):** these numbers are for
> **regression trend analysis on this hardware** — not production SLA
> targets. macOS/Bun/JSC behavior differs from Linux production (kernel
> scheduler, TCP stack, memory allocator). Use them to detect relative
> regressions between commits, not to size prod capacity.

## Prerequisites

```bash
cd examples/keel && oke dev          # keep running: pg :15850, redis :16850, pgdog :24850
export OKE_BENCH=1
export OKE_TEST_POSTGRES=1
export DATABASE_URL=postgres://...@127.0.0.1:24850/oke   # via pgdog
export OKE_TEST_REDIS_URL=redis://127.0.0.1:16850
```

Credentials are read from the environment at runtime — never hardcode or
print them (`examples/keel/.env.local` is the local source).

## Env gating

Mirrors `horizontal.integration.test.ts`:

```typescript
const LIVE_PG = process.env.OKE_TEST_POSTGRES_URL?.trim()
  ?? (process.env.OKE_TEST_POSTGRES === "1" ? process.env.DATABASE_URL : undefined);
const LIVE_REDIS = process.env.OKE_TEST_REDIS_URL ?? process.env.REDIS_URL;
describe.skipIf(!process.env.OKE_BENCH || !LIVE)(...);
```

## Commands

| Command | What |
| --- | --- |
| `bun run bench:load` | run every `src/bench/*.bench.ts` group (10 min timeout each) |
| `bun test src/bench/g01-rls-stamp.bench.ts` | run one group |

### Group execution order

Phase 0 (harness) → **G12** (doctor fd check) → G1 → G2, G4, G7, G8, G9,
G13 → G3 (re-verifies G12 fd estimate) → G5 → G6 → G10 → G11 → G14 → G15.

### Manual child modes

```bash
bun run src/bench/load-child.ts serve 6601 &
curl -s localhost:6601/_/ready     # {"ready":true,"pid":...,"port":6601,...}
kill %1

bun run src/bench/load-child.ts flood-sse http://127.0.0.1:6601 bench-live 200
bun run src/bench/load-child.ts sustained http://127.0.0.1:6601 50 60
bun run src/bench/load-child.ts shutdown-test   # drains on SIGTERM
```

## Fix protocol

Run → capture JSON + command → if issue found: minimal root-cause fix
(+ unit test when touching doctor/kernel/store/signal) → re-run affected
group(s) only; sustained runs always restart from t=0. Record
`measured → issue → fix → re-measured` in the artifact. If a fix is too
large/risky (e.g. pooling redesign): stop and report explicitly.

## Layout

```
lib/report.ts         artifact writer + percentile helpers
lib/infra.ts          live-env resolution, waitForFile, jsonl loader
lib/rss-sampler.ts    RSS/open-fd sampler + leak slope
lib/event-loop-lag.ts setInterval-drift probe
load-app.ts           the served app (all bench routes)
load-child.ts         multi-mode entrypoint (serve / flood-sse / sustained / shutdown-test)
results/              JSON artifacts (gitignored)
```
