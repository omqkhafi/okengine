# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.13.0 · measured 2026-08-18T13:03:43.943Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 13.61 kB  | 15.00 kB  |
| Client runtime                  | 2.06 kB   | 3.00 kB   |
| Console initial load            | 347.25 kB | 700.00 kB |
| Cold start on Bun               | 9.335 ms  | 75.000 ms |
| p99 routing overhead            | 0.001 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 43.41 kB  | 44.28 kB  |
| HTTP ping app (raw, externals)  | 125.49 kB | 128.00 kB |

## Exports

|              | Measured  | Ceiling   |
| ------------ | --------- | --------- |
| okengine     | 76.08 kB  | 77.60 kB  |
| ai           | 6.80 kB   | 7.05 kB   |
| auth         | 12.15 kB  | 12.40 kB  |
| channel      | 6.55 kB   | 6.80 kB   |
| client       | 2.21 kB   | 2.46 kB   |
| client-react | 7.82 kB   | 8.07 kB   |
| client/auth  | 573 B     | 829 B     |
| clock        | 15.14 kB  | 15.44 kB  |
| compiler     | 12.61 kB  | 12.86 kB  |
| config       | 1.25 kB   | 1.50 kB   |
| console      | 148.08 kB | 151.04 kB |
| full         | 87.74 kB  | 89.50 kB  |
| gate         | 5.15 kB   | 5.40 kB   |
| http         | 44.29 kB  | 45.17 kB  |
| i18n         | 3.63 kB   | 3.88 kB   |
| journal      | 2.21 kB   | 2.46 kB   |
| kernel       | 44.33 kB  | 45.22 kB  |
| mcp          | 9.67 kB   | 9.92 kB   |
| plugins      | 15.70 kB  | 16.02 kB  |
| runs         | 9.13 kB   | 9.38 kB   |
| signal       | 919 B     | 1.15 kB   |
| store        | 18.81 kB  | 19.19 kB  |
| test         | 13.99 kB  | 14.27 kB  |
| vault        | 12.40 kB  | 12.65 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 5.78 kB  | 6.03 kB |
| anonymous | 3.49 kB  | 3.74 kB |
| magicLink | 4.87 kB  | 5.12 kB |
| otp       | 6.57 kB  | 6.82 kB |
| twoFactor | 4.73 kB  | 4.98 kB |
| passkey   | 5.06 kB  | 5.31 kB |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 2.34 kB  | 2.59 kB |
| cors        | 2.17 kB  | 2.42 kB |
| csrf        | 1.81 kB  | 2.06 kB |
| ipAllowlist | 1.92 kB  | 2.17 kB |

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
| drivers                   | 72.07 kB | 73.51 kB |
| ai-anthropic              | 972 B    | 1.20 kB  |
| ai-mock                   | 1.10 kB  | 1.35 kB  |
| ai-ollama                 | 1.97 kB  | 2.22 kB  |
| ai-openai-compatible      | 1.84 kB  | 2.09 kB  |
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
| instances-postgres        | 1.07 kB  | 1.32 kB  |
| journal-postgres          | 2.88 kB  | 3.13 kB  |
| kv-lua                    | 1.01 kB  | 1.26 kB  |
| meilisearch               | 1.72 kB  | 1.97 kB  |
| memory                    | 9.91 kB  | 10.16 kB |
| ollama                    | 1.96 kB  | 2.21 kB  |
| pg-extensions             | 6.76 kB  | 7.01 kB  |
| pg-rls                    | 1.39 kB  | 1.64 kB  |
| pglite                    | 726 B    | 982 B    |
| pgvector                  | 23.20 kB | 23.66 kB |
| postgres                  | 1.38 kB  | 1.63 kB  |
| redis                     | 2.07 kB  | 2.32 kB  |
| s3                        | 1.87 kB  | 2.12 kB  |
| s3-ensure-bucket          | 1.15 kB  | 1.40 kB  |
| signal-engine             | 5.16 kB  | 5.41 kB  |
| signal-memory             | 5.20 kB  | 5.45 kB  |
| signal-nats               | 5.69 kB  | 5.94 kB  |
| signal-postgres           | 7.33 kB  | 7.58 kB  |
| signal-redis              | 6.30 kB  | 6.55 kB  |
| vault-1password           | 1.98 kB  | 2.23 kB  |
| vault-aws-secrets-manager | 1.60 kB  | 1.85 kB  |
| vault-azure-key-vault     | 1.60 kB  | 1.85 kB  |
| vault-builtin             | 10.80 kB | 11.05 kB |
| vault-doppler             | 1.62 kB  | 1.87 kB  |
| vault-dotenv-parse        | 746 B    | 1002 B   |
| vault-env                 | 895 B    | 1.12 kB  |
| vault-gcp-secret-manager  | 1.86 kB  | 2.11 kB  |
| vault-managed             | 5.03 kB  | 5.28 kB  |
| vault-memory              | 375 B    | 631 B    |
| vault-remote-bag          | 1.03 kB  | 1.28 kB  |
