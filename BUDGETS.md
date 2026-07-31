# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.5.0 · measured 2026-07-31T23:14:26.448Z_

Core rows are absolute AGENTS caps. Exports and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`).

## Core

|                       | Measured  | Limit     |
| --------------------- | --------- | --------- |
| Kernel (edge profile) | 12.45 kB  | 15.00 kB  |
| Client runtime        | 1.67 kB   | 3.00 kB   |
| Console initial load  | 86.21 kB  | 300.00 kB |
| Cold start on Bun     | 35.554 ms | 75.000 ms |
| p99 routing overhead  | 0.001 ms  | 1.000 ms  |

## Exports

|              | Measured | Ceiling  |
| ------------ | -------- | -------- |
| okengine     | 60.12 kB | 61.32 kB |
| ai           | 3.44 kB  | 3.69 kB  |
| auth         | 13.40 kB | 13.67 kB |
| channel      | 4.59 kB  | 4.84 kB  |
| client       | 1.80 kB  | 2.05 kB  |
| client-react | 7.82 kB  | 8.07 kB  |
| client/auth  | 573 B    | 829 B    |
| clock        | 10.09 kB | 10.34 kB |
| config       | 890 B    | 1.12 kB  |
| console      | 79.64 kB | 81.23 kB |
| gate         | 6.14 kB  | 6.39 kB  |
| mcp          | 9.39 kB  | 9.64 kB  |
| plugins      | 13.84 kB | 14.12 kB |
| runs         | 6.15 kB  | 6.40 kB  |
| signal       | 888 B    | 1.12 kB  |
| store        | 12.70 kB | 12.96 kB |
| test         | 9.27 kB  | 9.52 kB  |
| vault        | 2.42 kB  | 2.67 kB  |

## Drivers

|                      | Measured | Ceiling  |
| -------------------- | -------- | -------- |
| drivers              | 46.66 kB | 47.59 kB |
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
| drizzle-dialect      | 326 B    | 582 B    |
| fs                   | 701 B    | 957 B    |
| kv-lua               | 1.01 kB  | 1.26 kB  |
| libsql               | 7.34 kB  | 7.59 kB  |
| meilisearch          | 1.38 kB  | 1.63 kB  |
| memory               | 4.12 kB  | 4.37 kB  |
| pglite               | 620 B    | 876 B    |
| pgvector             | 23.11 kB | 23.57 kB |
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
| vault-managed        | 416 B    | 672 B    |
| vault-memory         | 375 B    | 631 B    |
| vault-openbao        | 1.06 kB  | 1.31 kB  |
