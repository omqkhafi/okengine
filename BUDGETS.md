# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.10.2 · measured 2026-08-07T19:47:08.160Z_

Core rows are absolute AGENTS caps. Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`).

## Core

|                       | Measured  | Limit     |
| --------------------- | --------- | --------- |
| Kernel (edge profile) | 14.80 kB  | 15.00 kB  |
| Client runtime        | 1.70 kB   | 3.00 kB   |
| Console initial load  | 86.33 kB  | 300.00 kB |
| Cold start on Bun     | 36.925 ms | 75.000 ms |
| p99 routing overhead  | 0.001 ms  | 1.000 ms  |

## Exports

|                | Measured | Ceiling  |
| -------------- | -------- | -------- |
| okengine       | 73.17 kB | 73.25 kB |
| ai             | 7.15 kB  | 7.40 kB  |
| auth           | 15.82 kB | 16.17 kB |
| channel        | 6.55 kB  | 6.70 kB  |
| client         | 1.83 kB  | 2.08 kB  |
| client-react   | 7.82 kB  | 8.07 kB  |
| client/auth    | 573 B    | 829 B    |
| clock **FAIL** | 15.22 kB | 15.16 kB |
| config         | 901 B    | 1.13 kB  |
| console        | 94.00 kB | 94.43 kB |
| gate           | 6.18 kB  | 6.43 kB  |
| mcp            | 9.40 kB  | 9.65 kB  |
| plugins        | 19.82 kB | 20.15 kB |
| runs           | 6.86 kB  | 7.11 kB  |
| signal         | 919 B    | 1.13 kB  |
| store          | 17.32 kB | 17.34 kB |
| test           | 12.27 kB | 12.44 kB |
| vault          | 2.46 kB  | 2.69 kB  |

## Plugins

### Auth

|           | Measured | Ceiling  |
| --------- | -------- | -------- |
| username  | 9.92 kB  | 10.18 kB |
| anonymous | 5.42 kB  | 5.67 kB  |
| magicLink | 9.11 kB  | 9.34 kB  |
| otp       | 10.82 kB | 11.05 kB |
| twoFactor | 9.00 kB  | 9.26 kB  |
| passkey   | 9.32 kB  | 9.57 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 2.34 kB  | 2.51 kB |
| cors        | 2.16 kB  | 2.35 kB |
| csrf        | 4.16 kB  | 4.33 kB |
| ipAllowlist | 4.26 kB  | 4.45 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 1.67 kB  | 1.84 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 1.97 kB  | 2.15 kB |

## Drivers

|                          | Measured | Ceiling  |
| ------------------------ | -------- | -------- |
| drivers                  | 56.02 kB | 56.90 kB |
| ai-anthropic             | 972 B    | 1.20 kB  |
| ai-mock                  | 896 B    | 1.13 kB  |
| ai-ollama                | 1.97 kB  | 2.22 kB  |
| ai-openai-compatible     | 1.78 kB  | 2.03 kB  |
| channel-console          | 734 B    | 990 B    |
| channel-fcm              | 964 B    | 1.19 kB  |
| channel-msegat           | 740 B    | 996 B    |
| channel-resend           | 356 B    | 612 B    |
| channel-sently-map       | 454 B    | 710 B    |
| channel-smtp             | 455 B    | 711 B    |
| channel-sndr             | 375 B    | 631 B    |
| channel-taqnyat          | 737 B    | 993 B    |
| channel-taqnyat-mail     | 430 B    | 686 B    |
| channel-taqnyat-whatsapp | 829 B    | 1.06 kB  |
| channel-unifonic         | 756 B    | 1012 B   |
| channel-wa-cloud         | 800 B    | 1.03 kB  |
| channel-webpush          | 947 B    | 1.17 kB  |
| clock-postgres           | 2.45 kB  | 2.70 kB  |
| drizzle-dialect          | 326 B    | 582 B    |
| fs                       | 701 B    | 957 B    |
| journal-postgres         | 2.86 kB  | 3.11 kB  |
| kv-lua                   | 1.01 kB  | 1.26 kB  |
| libsql                   | 7.34 kB  | 7.59 kB  |
| meilisearch              | 1.38 kB  | 1.63 kB  |
| memory                   | 4.12 kB  | 4.37 kB  |
| ollama                   | 1.96 kB  | 2.21 kB  |
| pglite                   | 620 B    | 876 B    |
| pgvector                 | 23.11 kB | 23.57 kB |
| postgres                 | 1.38 kB  | 1.63 kB  |
| redis                    | 2.00 kB  | 2.25 kB  |
| s3                       | 958 B    | 1.19 kB  |
| signal-engine            | 6.95 kB  | 6.96 kB  |
| signal-memory            | 6.99 kB  | 7.00 kB  |
| signal-nats              | 7.47 kB  | 7.48 kB  |
| signal-postgres          | 9.13 kB  | 9.14 kB  |
| signal-redis             | 8.09 kB  | 8.10 kB  |
| sqlite                   | 440 B    | 696 B    |
| vault-dotenv-parse       | 562 B    | 818 B    |
| vault-env                | 894 B    | 1.12 kB  |
| vault-managed            | 416 B    | 672 B    |
| vault-memory             | 375 B    | 631 B    |
| vault-openbao            | 1.06 kB  | 1.31 kB  |
