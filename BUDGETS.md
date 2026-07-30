# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.3.2 · measured 2026-07-30T12:36:04.208Z_

Core rows are absolute AGENTS caps. Exports and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`).

## Core

|                       | Measured  | Limit     |
| --------------------- | --------- | --------- |
| Kernel (edge profile) | 9.52 kB   | 15.00 kB  |
| Client runtime        | 1.67 kB   | 3.00 kB   |
| Console initial load  | 86.24 kB  | 300.00 kB |
| Cold start on Bun     | 24.598 ms | 75.000 ms |
| p99 routing overhead  | 0.001 ms  | 1.000 ms  |

## Exports

|          | Measured | Ceiling  |
| -------- | -------- | -------- |
| okengine | 49.68 kB | 50.67 kB |
| ai       | 3.35 kB  | 3.60 kB  |
| auth     | 4.85 kB  | 5.10 kB  |
| channel  | 4.57 kB  | 4.82 kB  |
| client   | 1.80 kB  | 2.05 kB  |
| clock    | 8.85 kB  | 9.10 kB  |
| config   | 890 B    | 1.12 kB  |
| console  | 69.85 kB | 71.25 kB |
| gate     | 3.80 kB  | 4.05 kB  |
| mcp      | 9.26 kB  | 9.51 kB  |
| plugins  | 4.45 kB  | 4.70 kB  |
| runs     | 6.15 kB  | 6.40 kB  |
| signal   | 861 B    | 1.09 kB  |
| store    | 12.34 kB | 12.59 kB |
| test     | 9.15 kB  | 9.40 kB  |
| vault    | 2.42 kB  | 2.67 kB  |

## Drivers

|                      | Measured | Ceiling  |
| -------------------- | -------- | -------- |
| drivers              | 20.15 kB | 20.55 kB |
| ai-anthropic         | 972 B    | 1.20 kB  |
| ai-mock              | 663 B    | 919 B    |
| ai-openai-compatible | 936 B    | 1.16 kB  |
| channel-console      | 734 B    | 990 B    |
| channel-fcm          | 777 B    | 1.01 kB  |
| channel-resend       | 356 B    | 612 B    |
| channel-smtp         | 405 B    | 661 B    |
| channel-unifonic     | 695 B    | 951 B    |
| channel-wa-cloud     | 742 B    | 998 B    |
| channel-webpush      | 1.66 kB  | 1.91 kB  |
| drizzle-dialect      | 315 B    | 571 B    |
| fs                   | 701 B    | 957 B    |
| kv-lua               | 1.01 kB  | 1.26 kB  |
| memory               | 4.12 kB  | 4.37 kB  |
| pgvector             | 1001 B   | 1.23 kB  |
| postgres             | 1.38 kB  | 1.63 kB  |
| redis                | 2.00 kB  | 2.25 kB  |
| s3                   | 958 B    | 1.19 kB  |
| signal-engine        | 3.32 kB  | 3.57 kB  |
| signal-memory        | 3.36 kB  | 3.61 kB  |
| signal-nats          | 3.85 kB  | 4.10 kB  |
| signal-postgres      | 5.19 kB  | 5.44 kB  |
| signal-redis         | 4.48 kB  | 4.73 kB  |
| sqlite               | 440 B    | 696 B    |
| vault-dotenv-parse   | 562 B    | 818 B    |
| vault-env            | 894 B    | 1.12 kB  |
| vault-infisical      | 571 B    | 827 B    |
| vault-managed        | 416 B    | 672 B    |
| vault-memory         | 375 B    | 631 B    |
| vault-openbao        | 1.06 kB  | 1.31 kB  |
