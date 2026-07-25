# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.2.1 · measured 2026-07-25T20:51:40.420Z_

Core rows are absolute AGENTS caps. Exports and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `age-encryption`, `sently`, `oxc-parser`, `ajv`).

## Core

| | Measured | Limit |
|---|---|---|
| Kernel (edge profile) | 8.79 kB | 15.00 kB |
| Client runtime | 1.67 kB | 3.00 kB |
| Console initial load | 84.61 kB | 300.00 kB |
| Cold start on Bun | 43.532 ms | 75.000 ms |
| p99 routing overhead | 0.001 ms | 1.000 ms |

## Exports

| | Measured | Ceiling |
|---|---|---|
| okengine | 41.21 kB | 42.03 kB |
| ai | 3.35 kB | 3.60 kB |
| auth | 4.83 kB | 5.08 kB |
| channel | 4.57 kB | 4.82 kB |
| client | 1.80 kB | 2.05 kB |
| clock | 8.52 kB | 8.77 kB |
| config | 314 B | 570 B |
| console | 61.86 kB | 63.10 kB |
| gate | 3.80 kB | 4.05 kB |
| mcp | 8.26 kB | 8.51 kB |
| runs | 6.15 kB | 6.40 kB |
| signal | 861 B | 1.09 kB |
| store | 5.66 kB | 5.91 kB |
| test | 9.09 kB | 9.34 kB |
| vault | 2.30 kB | 2.55 kB |

## Drivers

| | Measured | Ceiling |
|---|---|---|
| drivers | 19.60 kB | 19.99 kB |
| ai-anthropic | 972 B | 1.20 kB |
| ai-mock | 663 B | 919 B |
| ai-openai-compatible | 936 B | 1.16 kB |
| channel-console | 734 B | 990 B |
| channel-fcm | 777 B | 1.01 kB |
| channel-resend | 356 B | 612 B |
| channel-smtp | 405 B | 661 B |
| channel-unifonic | 695 B | 951 B |
| channel-wa-cloud | 742 B | 998 B |
| channel-webpush | 1.66 kB | 1.91 kB |
| fs | 701 B | 957 B |
| kv-lua | 1.01 kB | 1.26 kB |
| memory | 3.09 kB | 3.34 kB |
| pgvector | 1001 B | 1.23 kB |
| postgres | 1.38 kB | 1.63 kB |
| redis | 2.00 kB | 2.25 kB |
| s3 | 825 B | 1.06 kB |
| signal-engine | 3.32 kB | 3.57 kB |
| signal-memory | 3.36 kB | 3.61 kB |
| signal-nats | 3.85 kB | 4.10 kB |
| signal-postgres | 5.19 kB | 5.44 kB |
| signal-redis | 4.48 kB | 4.73 kB |
| sqlite | 440 B | 696 B |
| vault-dotenv-parse | 562 B | 818 B |
| vault-env | 894 B | 1.12 kB |
| vault-infisical | 571 B | 827 B |
| vault-managed | 416 B | 672 B |
| vault-memory | 375 B | 631 B |
| vault-openbao | 608 B | 864 B |
| vault-sops | 1.59 kB | 1.84 kB |
