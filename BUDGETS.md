# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.7.0 · measured 2026-08-03T21:25:43.857Z_

Core rows are absolute AGENTS caps. Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`).

## Core

|                       | Measured  | Limit     |
| --------------------- | --------- | --------- |
| Kernel (edge profile) | 13.63 kB  | 15.00 kB  |
| Client runtime        | 1.70 kB   | 3.00 kB   |
| Console initial load  | 86.32 kB  | 300.00 kB |
| Cold start on Bun     | 66.102 ms | 75.000 ms |
| p99 routing overhead  | 0.002 ms  | 1.000 ms  |

## Exports

|              | Measured | Ceiling  |
| ------------ | -------- | -------- |
| okengine     | 68.47 kB | 69.84 kB |
| ai           | 7.15 kB  | 7.40 kB  |
| auth         | 15.83 kB | 16.15 kB |
| channel      | 5.22 kB  | 5.47 kB  |
| client       | 1.83 kB  | 2.08 kB  |
| client-react | 7.82 kB  | 8.07 kB  |
| client/auth  | 573 B    | 829 B    |
| clock        | 14.05 kB | 14.34 kB |
| config       | 901 B    | 1.13 kB  |
| console      | 89.19 kB | 90.98 kB |
| gate         | 6.16 kB  | 6.41 kB  |
| mcp          | 9.46 kB  | 9.71 kB  |
| plugins      | 18.73 kB | 19.10 kB |
| runs         | 6.15 kB  | 6.40 kB  |
| signal       | 905 B    | 1.13 kB  |
| store        | 16.99 kB | 17.33 kB |
| test         | 11.06 kB | 11.31 kB |
| vault        | 2.44 kB  | 2.69 kB  |

## Plugins

### Auth

|             | Measured | Ceiling  |
| ----------- | -------- | -------- |
| username    | 9.97 kB  | 10.22 kB |
| anonymous   | 5.46 kB  | 5.71 kB  |
| magicLink   | 9.15 kB  | 9.40 kB  |
| emailOtp    | 9.09 kB  | 9.34 kB  |
| phoneNumber | 8.68 kB  | 8.93 kB  |
| twoFactor   | 9.05 kB  | 9.30 kB  |
| passkey     | 9.36 kB  | 9.61 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 2.26 kB  | 2.51 kB |
| cors        | 2.10 kB  | 2.35 kB |
| csrf        | 4.08 kB  | 4.33 kB |
| ipAllowlist | 4.20 kB  | 4.45 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 1.59 kB  | 1.84 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 1.90 kB  | 2.15 kB |

## Drivers

|                      | Measured | Ceiling  |
| -------------------- | -------- | -------- |
| drivers              | 55.62 kB | 56.74 kB |
| ai-anthropic         | 972 B    | 1.20 kB  |
| ai-mock              | 896 B    | 1.13 kB  |
| ai-ollama            | 1.97 kB  | 2.22 kB  |
| ai-openai-compatible | 1.78 kB  | 2.03 kB  |
| channel-console      | 734 B    | 990 B    |
| channel-fcm          | 964 B    | 1.19 kB  |
| channel-msegat       | 740 B    | 996 B    |
| channel-resend       | 356 B    | 612 B    |
| channel-sently-map   | 454 B    | 710 B    |
| channel-smtp         | 455 B    | 711 B    |
| channel-sndr         | 375 B    | 631 B    |
| channel-taqnyat      | 737 B    | 993 B    |
| channel-taqnyat-mail | 430 B    | 686 B    |
| channel-unifonic     | 756 B    | 1012 B   |
| channel-wa-cloud     | 800 B    | 1.03 kB  |
| channel-webpush      | 947 B    | 1.17 kB  |
| clock-postgres       | 2.45 kB  | 2.70 kB  |
| drizzle-dialect      | 326 B    | 582 B    |
| fs                   | 701 B    | 957 B    |
| journal-postgres     | 2.86 kB  | 3.11 kB  |
| kv-lua               | 1.01 kB  | 1.26 kB  |
| libsql               | 7.34 kB  | 7.59 kB  |
| meilisearch          | 1.38 kB  | 1.63 kB  |
| memory               | 4.12 kB  | 4.37 kB  |
| ollama               | 1.96 kB  | 2.21 kB  |
| pglite               | 620 B    | 876 B    |
| pgvector             | 23.11 kB | 23.57 kB |
| postgres             | 1.38 kB  | 1.63 kB  |
| redis                | 2.00 kB  | 2.25 kB  |
| s3                   | 958 B    | 1.19 kB  |
| signal-engine        | 6.66 kB  | 6.91 kB  |
| signal-memory        | 6.70 kB  | 6.95 kB  |
| signal-nats          | 7.18 kB  | 7.43 kB  |
| signal-postgres      | 8.79 kB  | 9.04 kB  |
| signal-redis         | 7.80 kB  | 8.05 kB  |
| sqlite               | 440 B    | 696 B    |
| vault-dotenv-parse   | 562 B    | 818 B    |
| vault-env            | 894 B    | 1.12 kB  |
| vault-managed        | 416 B    | 672 B    |
| vault-memory         | 375 B    | 631 B    |
| vault-openbao        | 1.06 kB  | 1.31 kB  |
