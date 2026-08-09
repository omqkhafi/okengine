# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.11.0 · measured 2026-08-09T16:42:01.030Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 14.93 kB  | 15.00 kB  |
| Client runtime                  | 1.70 kB   | 3.00 kB   |
| Console initial load            | 86.33 kB  | 300.00 kB |
| Cold start on Bun **FAIL**      | 82.428 ms | 75.000 ms |
| p99 routing overhead            | 0.003 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 42.33 kB  | 43.17 kB  |
| HTTP ping app (raw, externals)  | 128.76 kB | 131.34 kB |

## Exports

|              | Measured  | Ceiling   |
| ------------ | --------- | --------- |
| okengine     | 67.85 kB  | 69.21 kB  |
| ai           | 7.19 kB   | 7.44 kB   |
| auth         | 15.91 kB  | 16.23 kB  |
| channel      | 6.55 kB   | 6.80 kB   |
| client       | 1.83 kB   | 2.08 kB   |
| client-react | 7.82 kB   | 8.07 kB   |
| client/auth  | 573 B     | 829 B     |
| clock        | 16.60 kB  | 16.94 kB  |
| compiler     | 13.89 kB  | 14.17 kB  |
| config       | 1.25 kB   | 1.50 kB   |
| console      | 106.92 kB | 109.06 kB |
| full         | 75.56 kB  | 77.07 kB  |
| gate         | 6.19 kB   | 6.44 kB   |
| http         | 42.46 kB  | 43.31 kB  |
| i18n         | 3.63 kB   | 3.88 kB   |
| journal      | 2.21 kB   | 2.46 kB   |
| kernel       | 42.81 kB  | 43.66 kB  |
| mcp          | 9.40 kB   | 9.65 kB   |
| plugins      | 19.92 kB  | 20.32 kB  |
| runs         | 6.99 kB   | 7.24 kB   |
| signal       | 919 B     | 1.15 kB   |
| store        | 17.39 kB  | 17.74 kB  |
| test         | 12.45 kB  | 12.70 kB  |
| vault        | 11.19 kB  | 11.44 kB  |

## Plugins

### Auth

|           | Measured | Ceiling  |
| --------- | -------- | -------- |
| username  | 10.01 kB | 10.26 kB |
| anonymous | 5.42 kB  | 5.67 kB  |
| magicLink | 9.20 kB  | 9.45 kB  |
| otp       | 10.90 kB | 11.15 kB |
| twoFactor | 9.09 kB  | 9.34 kB  |
| passkey   | 9.41 kB  | 9.66 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 2.34 kB  | 2.59 kB |
| cors        | 2.16 kB  | 2.41 kB |
| csrf        | 4.22 kB  | 4.47 kB |
| ipAllowlist | 4.34 kB  | 4.59 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 1.67 kB  | 1.92 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 1.97 kB  | 2.22 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 61.86 kB | 63.10 kB |
| ai-anthropic              | 972 B    | 1.20 kB  |
| ai-mock                   | 896 B    | 1.13 kB  |
| ai-ollama                 | 1.97 kB  | 2.22 kB  |
| ai-openai-compatible      | 1.78 kB  | 2.03 kB  |
| channel-console           | 734 B    | 990 B    |
| channel-fcm               | 964 B    | 1.19 kB  |
| channel-msegat            | 740 B    | 996 B    |
| channel-resend            | 356 B    | 612 B    |
| channel-sently-map        | 454 B    | 710 B    |
| channel-smtp              | 455 B    | 711 B    |
| channel-sndr              | 375 B    | 631 B    |
| channel-taqnyat           | 737 B    | 993 B    |
| channel-taqnyat-mail      | 430 B    | 686 B    |
| channel-taqnyat-whatsapp  | 829 B    | 1.06 kB  |
| channel-unifonic          | 756 B    | 1012 B   |
| channel-wa-cloud          | 800 B    | 1.03 kB  |
| channel-webpush           | 947 B    | 1.17 kB  |
| clock-postgres            | 2.45 kB  | 2.70 kB  |
| drizzle-dialect           | 314 B    | 570 B    |
| fs                        | 701 B    | 957 B    |
| journal-postgres          | 2.88 kB  | 3.13 kB  |
| kv-lua                    | 1.01 kB  | 1.26 kB  |
| meilisearch               | 1.38 kB  | 1.63 kB  |
| memory                    | 4.12 kB  | 4.37 kB  |
| ollama                    | 1.96 kB  | 2.21 kB  |
| pglite                    | 648 B    | 904 B    |
| pgvector                  | 23.11 kB | 23.57 kB |
| postgres                  | 1.38 kB  | 1.63 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 958 B    | 1.19 kB  |
| signal-engine             | 7.03 kB  | 7.28 kB  |
| signal-memory             | 7.07 kB  | 7.32 kB  |
| signal-nats               | 7.56 kB  | 7.81 kB  |
| signal-postgres           | 9.21 kB  | 9.46 kB  |
| signal-redis              | 8.18 kB  | 8.43 kB  |
| vault-aws-secrets-manager | 1.46 kB  | 1.71 kB  |
| vault-builtin             | 9.83 kB  | 10.08 kB |
| vault-dotenv-parse        | 562 B    | 818 B    |
| vault-env                 | 894 B    | 1.12 kB  |
| vault-managed             | 1.95 kB  | 2.20 kB  |
| vault-memory              | 375 B    | 631 B    |
