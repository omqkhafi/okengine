# OKE System-wide Load Testing — 15 Groups (Final Report)

> These numbers are for **regression trend analysis on this hardware** — not production SLA targets. macOS/Bun/JSC behavior will differ from Linux production (kernel scheduler, TCP stack, memory allocator). Use them to detect relative regressions between commits, not to size prod capacity.

- **Hardware:** Apple M4 MacBook Pro, 24 GB RAM (macOS scheduler, TCP stack, JSC allocator)
- **Date:** 2026-08-25 · **Engine:** Bun ≥1.3.14 · **Branch:** dev
- **Infra:** `examples/keel` docker stack — Postgres :15850, pgdog :24850, Redis :16850, Mailpit SMTP :20850
- **Harness:** `src/bench/` (committed) · per-group JSON artifacts in `src/bench/results/` (gitignored)
- **Run-all:** `bun run bench:load` (requires `OKE_BENCH=1` + live-infra env vars; benches are NOT in `bun run ci`)

## Fix protocol outcome (summary)

Six real product defects were found and fixed during the campaign, each recorded as measured → issue → fix → re-measured in its group's artifact:

| #   | Defect                                                                                          | Root cause                                                                                      | Fix                                                                                                                 | Verified by                           |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | `rotateMaster` → `ERR_POSTGRES_UNSAFE_TRANSACTION` on shared pool (G7b)                         | manual BEGIN needs a dedicated client                                                           | `connectPostgres` honors `pool.max === 1` as opt-in dedicated client (`src/drivers/postgres.ts`)                    | G7b full rerun, vault suites          |
| 2   | False "lease held by another instance" during rotation (G7b)                                    | rotate-lease claim used `FOR UPDATE SKIP LOCKED`; audit-append contention misread as lease loss | plain `FOR UPDATE` in `src/elements/vault/storage.ts`                                                               | 5/5 green vault+driver suite runs     |
| 3   | 25× `tuple concurrently updated` under concurrent identity bags (G8c)                           | RLS helper install memoized per handle → raced `CREATE OR REPLACE FUNCTION`                     | per-connection dedupe via `WeakMap<SqlConnection, Promise>` (`src/elements/store/sql-session.ts`) + regression test | G8c full sweep, G1 blast-radius rerun |
| 4   | Out-of-the-box email always fails (~3s retry then dead) (G13d)                                  | default sender `oke@localhost` dotless → SMTP validation reject                                 | default → `oke@localhost.test` (`src/elements/channel/runtime.ts`) + regression test                                | 150/150 Mailpit deliveries            |
| 5   | All concurrent sends through one transport die ("Unexpected SMTP response for DATA end") (G13d) | shared SMTP socket wire interleaving                                                            | per-transport send serialization in `createChannelRuntime` + regression test                                        | full send sweep from t=0              |
| 6   | Doctor fd estimate off by ~4,400% (G3b vs G12)                                                  | formula budgeted 64 fds/SSE subscriber; reality ≈1.5                                            | measured constant `FD_COST_PER_SUBSCRIBER = 1.5` exported from `src/cli/doctor-fd.ts` + linear-scaling test         | re-measured Δ +6.7%                   |

Plus one pre-phase fix delivered by Group 12 itself: **`oke doctor file_descriptor_limit` check** (`src/cli/doctor-fd.ts`, wired into `runDoctor()` after port checks, injectable `detectFdPressure`; severity error when `softLimit < estimatedNeed`, warn when `< estimatedNeed × 2`). Doctor test suite: 15 pass / 0 fail. Live CLI: warns at `ulimit -n 256`, clean at 65536.

Harness-only bugs (no product impact, each fixed before final runs, sustained reruns restarted from t=0): thinned-sample RPS accounting (G5), tail-RSS window too small (G5), single emit ≠ M messages (G3a), fd count taken after teardown (G3c), POST vs GET `/ping` (G6), gate 429s misclassified as errors (G5), `Math.max(...arr)` overflow at ~3M samples (G5), post-SIGTERM refusals miscounted as dropped work (G14).

---

## G1 — Serialized RLS queue (PGlite)

**Command:** `OKE_BENCH=1 bun test ./src/bench/g01-rls-stamp.bench.ts --timeout 120000`
Sweep N ∈ {10,50,100,200,500} × bind shapes {3,4 binds} on one PGlite connection behind `withRlsStampLock`.

| N   | p50 (ms) | p99 (ms) | ops/s |
| --- | -------- | -------- | ----- |
| 10  | 1.9      | 4.2      | 2,803 |
| 50  | 6.7      | 14.5     | 3,560 |
| 100 | 13.3     | 27.1     | 3,703 |
| 200 | 27.5     | 56.2     | 3,761 |
| 500 | 60.2     | 128.7    | 4,026 |

Latency degrades linearly with N while throughput _rises_ (queue pipelines cleanly) — no super-linear collapse. Correctness sanity (concurrent identities don't leak across stamps): pass.
**Issues:** none. Re-run post-G8-fix (blast radius): same shape, confirmed unchanged. Artifact: `G1-1787650152550.json`

## G2 — Tenancy at scale (clock.perTenant)

**Command:** `OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g02-clock-per-tenant.bench.ts --timeout 180000`
120 perTenant rows seeded; concurrent lease acquisition via `CLAIM_LEASE_SQL` on live PG through pgdog.

| k   | claims | p50    | p99    | claims/s | duplicate fires |
| --- | ------ | ------ | ------ | -------- | --------------- |
| 4   | 1,440  | 49 ms  | 105 ms | 4,867    | **0**           |
| 16  | 5,760  | 182 ms | 355 ms | 5,366    | **0**           |

Zero duplicate fires across all 7,200 claims. Artifact: `G2-1787646500776.json`

## G3 — Signal under pressure (+ G12 fd re-verification)

**Commands:** three files, all `OKE_BENCH=1`.

- **G3a once-consumer sweep** (`g03-signal-once.bench.ts`, live PG outbox): 200 msgs × consumers {1,2,4,8,16} → 461→628 msgs/s delivery, zero loss/dupes at every level; `throughputPerSec()` scales 200→638. Note: Bun.SQL lacks LISTEN/NOTIFY — wakeup fanout is in-process (`src/bench/lib/signal-pg.ts`); cross-process wakeup untested. Artifact: `G3a-signal-once-…json`
- **G3b SSE memory + fd growth** (`g03-signal-sse-memory.bench.ts`, `load-child flood-sse`): 100→500 SSE subscribers sampled every 5 s. Observed **1.41 fds/subscriber**, RSS slope 0.96 MB/min (flat), peak 90 MB.
  - **First measurement FAILED the G12 cross-check**: doctor estimated 64 fds/subscriber (Δ ≈ +4,076%). → Fix #6 above → re-measured Δ **+6.7%** ✅. Artifact carries both runs. Artifact: `G3b-signal-sse-memory-…json`
  - Residual note: wave-2 did not reach ~500 simultaneous SSE (steady-state achieved below target); trend still valid.
- **G3c reconnect storm** (`g03-signal-reconnect.bench.ts`): backoff verified pure — 500 ms clamp floor, exactly 30 s ceiling; live storm: SIGKILL + restart, **200/200 clients reconnected**, observed backoffs ∈ [500, 2000] ms. Artifact: `G3c-signal-reconnect-…json`

## G4 — Identity/secrets hot path

**Command:** `OKE_BENCH=1 bun test ./src/bench/g04-auth-vault-hotpath.bench.ts`

| Probe                                   | Throughput           | p99                                  |
| --------------------------------------- | -------------------- | ------------------------------------ |
| `authenticateApiKey` (1k/10k/50k iters) | ~87k–102k ops/s flat | ~0.03 ms                             |
| raw HMAC verify                         | ~64k/s               | —                                    |
| boot-bag `vaultRuntime.read`            | ~15.3M reads/s       | ~0                                   |
| request-time `fx.vault.get`             | ~3.4M reads/s        | 0.001 ms                             |
| **added p99 (request-time − boot-bag)** | **0.001 ms**         | well inside the <1 ms routing budget |

Artifacts: `G4-auth-…json`, `G4-vault-…json`

## G5 — Sustained baseline + memory

**Command:** `OKE_BENCH=1 bun test ./src/bench/g05-sustained-full.bench.ts --timeout 600000` (auto-extended 300→540 s per rising-RSS rule)
Concurrency 50 closed-loop, 30× `/ping` + 20× mixed endpoints: **3,198,945 requests, 5,924 req/s total (ping 5,506 rps, mixed 418 rps), 0 errors**, ping p99 8.1 ms, mixed p99 317 ms. Six GC spike windows annotated as JSC-GC (window-p99 median 46 ms). RSS slope 6.52 MB/min full-run but **flat tail (0.57 MB/min last minute)** → JSC heap expansion ramp, not an unbounded leak (recorded in artifact issues). Gate's 48,956 deliberate 429s counted separately, not errors. Artifact: `G5-sustained-full-…json`

## G6 — Realistic mixed load

**Command:** `OKE_BENCH=1 bun test ./src/bench/g06-mixed-load.bench.ts --timeout 300000`
Single child: HTTP flood + once emit/drain + live emits + 50 SSE + clock tick concurrently.
Ping 4,381 rps (**−20.4 % vs G5 baseline** under contention), live SSE fan-out 9,082 events/s (592k frames received), event-loop lag p99 1.38 ms (max 1.88), 5 errors in 300k+ requests (<0.001 %). No anomaly → `--cpu-prof` deep dive not triggered. Artifact: `G6-mixed-load-…json`

## G7 — Vault under load

- **G7a crypto** (`g07-vault-crypto.bench.ts`): AES-256-GCM 1 KiB encrypt/decrypt 87k/96k ops/s (round-trip 47k); 64 KiB 28.4k/25.9k (round-trip 13.6k). No issues. Artifact: `G7a-crypto-…json`
- **G7b rotate-under-read** (`g07-vault-rotate-under-read.bench.ts`, extends `chaos-child` with additive `bench-read-loop` mode):
  - First attempt aborted pre-rotation: shared-pool transaction error → **Fix #1**; flaky false lease losses → **Fix #2**.
  - Re-measured from t=0: Arm A (in-process reader across rotation): 65 reads, **0 failed, 0 torn**, reader p99 5.0 ms during a 113 ms rotation window. Arm B (foreign process holding only the old key): 3,041 reads, 0 torn, 0 silent wrong-errors; 2,987 loud unwrap failures = correct old-key physics (chaos §3b contract). Artifacts: `G7b-rotate-under-read-…json`

## G8 — Raw Store SQL

**Command:** `OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g08-{store-sql,store-kv-durable,conn-oversubscribe}.bench.ts --timeout 300000`

- **G8a sustained SQL:** insert ~4,100/s (p99 0.99 ms), update 3,083/s (p99 0.95 ms), mixed read+write 1,782/s. Artifact: `G8a-…json`
- **G8b durable KV (`openDurableKv` tenant-prefix):** set 1,728/s, get-hit 3,344/s, get-miss 3,245/s, delete 3,301/s; 2k-key `list()` in 1.8 ms. Artifact: `G8b-…json`
- **G8c oversubscription (sharedSqlConn, N ∈ {50,100,200}):** calibration exposed race → **Fix #3**; re-measured from t=0: graceful stamp-lock queueing — p50 40.6→96.6 ms, throughput 1,001→1,676 ops/s rising with N, **0 pool-exhaustion errors**. Blast-radius: G1 re-run green. Artifact: `G8c-…json`

## G9 — Durable journal / fx.step

**Command:** `OKE_BENCH=1 OKE_TEST_POSTGRES=1 bun test ./src/bench/g09-journal-sustained.bench.ts --timeout 420000` (300 s, concurrency 16, real postgres SKIP LOCKED path)
**558,053 durable runs completed; 5,580 fx.steps/s; 9,301 journal writes/s.** Run p50 7.7 ms / p99 25.6 ms; backlog avg 12.6, final 12 (= concurrency, fully drained); **0 failed runs**; steps = 3 × completed runs exactly. Artifact: `G9-…json`

## G10 — Observability overhead

**Command:** `OKE_BENCH=1 bun test ./src/bench/g10-observability-contention.bench.ts --timeout 600000` (120 s per arm)
Identical load twice; arm B adds concurrent console `projectSignalsList()` loops on the same pool: **−13.4 % total throughput cost** (ping −13.4 %, durable −12.9 %, store −13.3 %). Console queries sustained 3,713 q/s at p99 1.4 ms; zero errors both arms. Artifact: `G10-observability-contention-…json`

## G11 — Repeated cold starts

**Command:** `OKE_BENCH=1 bun test ./src/bench/g11-cold-start-cycle.bench.ts --timeout 300000`
100 fresh `Bun.spawn` cycles (measure-style probe, no shared module cache): cycles 1–10 p50 **9.43 ms** vs 91–100 p50 **8.82 ms** (drop = expected OS/FS warmup — noted in artifact, not claimed as a win); overall p50 8.88 ms / p99 20.1 ms; parent RSS +0.05 MB/cycle (+5.3 MB total) — no leak signature. Artifact: `G11-cold-start-cycle-…json`

## G12 — OS fd limits (doctor)

Delivered before any SSE work: `file_descriptor_limit` finding in `oke doctor` (see Fix protocol outcome). Unit suite 15/15; live CLI warn/clean at ulimit 256/65536. **Field-validated by G3b**: initial estimate wrong by ~4,400 % → corrected to measured 1.5 fds/subscriber → re-measured Δ +6.7 %. Artifacts: G3b JSON (both runs) + doctor tests.

## G13 — Remaining elements

**Command:** `OKE_BENCH=1 OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g13-elements.bench.ts --timeout 300000`

| Sub-bench                                     | Result                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate `takeRate` @ high RPS (live redis EVAL)  | 95,304 takes/s, p99 1.5 ms; exact accounting: 5,000 allowed / 5,000 denied vs bucket max                                                        |
| `gated()` cumulative cost                     | 0.64 µs/op @1k → 0.30 µs/op @50k — sub-linear, no cumulative growth                                                                             |
| `fx.json.stream` concurrent (encodeSseStream) | 11,025 streams/s = 363,824 SSE frames/s @ concurrency 25; stream p99 5.6 ms                                                                     |
| Channel bulk send (RetryTransport → Mailpit)  | first runs dead → **Fixes #4 & #5**; re-measured from t=0: **150/150 delivered** (Mailpit delta exactly 150), 294 sends/s serialized, p99 63 ms |

Artifacts: `G13{a,b,c,d}-…json` (G13d carries both issue→fix→re-measured trails)

## G14 — Graceful shutdown under load

**Command:** `OKE_BENCH=1 OKE_TEST_POSTGRES=1 … DATABASE_URL=$DATABASE_URL bun test ./src/bench/g14-graceful-shutdown.bench.ts --timeout 120000`
Full `load-child serve` + `installGracefulShutdown`; 220 held SSE + 60 workers (~122k reqs, 3,026 RLS stamp writes) → frozen batch of 50 stamp writes → SIGTERM mid-handler: **50/50 in-flight drained, 0 dropped**, all SSE closed, time-to-exit ~202–219 ms. Methodology note in artifact: first calibration miscounted post-SIGTERM new-connection refusals as dropped work → replaced with frozen-batch design (harness-only change). Artifact: `G14-graceful-shutdown-…json`

## G15 — Cascading failure (slow Postgres)

**Command:** `OKE_BENCH=1 OKE_BENCH_PG_DELAY_MS=500 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g15-postgres-degradation.bench.ts --timeout 300000`
Test-only `delayedPostgresDriver()` wrapper sleeps before every query; live pgdog PG only.

| Arrival rate       | Achieved   | Max in-flight      | Errors |
| ------------------ | ---------- | ------------------ | ------ |
| 10/s               | 9.83 ops/s | 61                 | 0      |
| 20/s               | 19.7 ops/s | 122                | 0      |
| 40/s (2× overload) | 38.3 ops/s | 239 → drains to 12 | 0      |

RSS growth bounded (+15–23 MB); event-loop lag p99 ≤3 ms. Verdict: **bounded graceful backpressure** — no unbounded `withRlsStampLock` queue/OOM; Bun.SQL pool parallelism keeps service ≈ arrival even at 2× overload.

> **Honesty constraint (mandatory, also stamped in the artifact):** this is **not real chaos engineering** — it tests in-process queue/backpressure behavior when SQL is artificially stalled. It does **not** simulate network jitter, disk I/O contention, or connection pooler failure modes. Live Postgres only (G1's PGlite queue physics differ).

Artifact: `G15-postgres-degradation-…json` (+ extra stress-level artifacts)

---

## Verification status

- `bun run typecheck` ✅ · `bun run lint` ✅ (full repo, including keel + create-oke workspaces)
- Doctor suite 15/15 · channel suite 45 pass · store/vault/driver suites green after fixes
- Benches excluded from `bun run ci` (require Docker/live infra + long runtime); gated behind `OKE_BENCH=1`
- Existing `bun run bench` budget gates untouched

## Known limitations / follow-ups (trend-analysis scope)

1. Cross-process signal wakeup (LISTEN/NOTIFY substitute) untested — Bun.SQL limitation, documented in G3a artifact.
2. G3b wave-2 steady-state sat below the ~500-subscriber target; fd-per-subscriber trend unaffected.
3. Channel bulk throughput now bounded by per-transport serialization (correctness over throughput); revisit if fan-out email volume matters.
4. G15 is in-process backpressure only (see honesty note).
