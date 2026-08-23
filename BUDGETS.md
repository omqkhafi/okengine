# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.17.1 · measured 2026-08-23T07:17:26.468Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 15.05 kB  | 16.00 kB  |
| Client runtime                  | 3.75 kB   | 4.00 kB   |
| Console initial load            | 348.13 kB | 700.00 kB |
| Cold start on Bun               | 9.496 ms  | 75.000 ms |
| p99 routing overhead            | 0.001 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 40.67 kB  | 41.48 kB  |
| HTTP ping app (raw, externals)  | 117.95 kB | 120.31 kB |

## Exports

|              | Measured  | Ceiling   |
| ------------ | --------- | --------- |
| okengine     | 87.52 kB  | 89.27 kB  |
| ai           | 12.01 kB  | 12.26 kB  |
| auth         | 15.32 kB  | 15.62 kB  |
| channel      | 6.43 kB   | 6.68 kB   |
| client       | 4.01 kB   | 4.26 kB   |
| client-react | 7.98 kB   | 8.23 kB   |
| client/auth  | 559 B     | 815 B     |
| clock        | 15.94 kB  | 16.26 kB  |
| compiler     | 17.31 kB  | 17.66 kB  |
| config       | 1.21 kB   | 1.46 kB   |
| console      | 154.47 kB | 157.56 kB |
| full         | 98.53 kB  | 100.50 kB |
| gate         | 4.50 kB   | 4.75 kB   |
| http         | 41.70 kB  | 42.53 kB  |
| i18n         | 4.29 kB   | 4.54 kB   |
| journal      | 2.16 kB   | 2.41 kB   |
| kernel       | 47.99 kB  | 48.95 kB  |
| mcp          | 9.54 kB   | 9.79 kB   |
| plugins      | 16.00 kB  | 16.32 kB  |
| runs         | 8.99 kB   | 9.24 kB   |
| signal       | 1.26 kB   | 1.51 kB   |
| store        | 21.36 kB  | 21.79 kB  |
| test         | 18.75 kB  | 19.13 kB  |
| vault        | 12.78 kB  | 13.03 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 5.88 kB  | 6.13 kB |
| anonymous | 3.61 kB  | 3.86 kB |
| magicLink | 4.94 kB  | 5.19 kB |
| otp       | 6.65 kB  | 6.90 kB |
| twoFactor | 4.81 kB  | 5.06 kB |
| passkey   | 5.14 kB  | 5.39 kB |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 2.68 kB  | 2.93 kB |
| cors        | 2.52 kB  | 2.77 kB |
| csrf        | 2.12 kB  | 2.37 kB |
| ipAllowlist | 2.23 kB  | 2.48 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 2.03 kB  | 2.28 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 2.35 kB  | 2.60 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 72.67 kB | 74.13 kB |
| ai-anthropic              | 979 B    | 1.21 kB  |
| ai-mock                   | 1.05 kB  | 1.30 kB  |
| ai-ollama                 | 1.96 kB  | 2.21 kB  |
| ai-openai-compatible      | 1.77 kB  | 2.02 kB  |
| channel-console           | 701 B    | 957 B    |
| channel-fcm               | 934 B    | 1.16 kB  |
| channel-msegat            | 710 B    | 966 B    |
| channel-resend            | 345 B    | 601 B    |
| channel-sently-map        | 434 B    | 690 B    |
| channel-smtp              | 438 B    | 694 B    |
| channel-sndr              | 361 B    | 617 B    |
| channel-taqnyat           | 706 B    | 962 B    |
| channel-taqnyat-mail      | 413 B    | 669 B    |
| channel-taqnyat-whatsapp  | 798 B    | 1.03 kB  |
| channel-unifonic          | 725 B    | 981 B    |
| channel-wa-cloud          | 769 B    | 1.00 kB  |
| channel-webpush           | 910 B    | 1.14 kB  |
| clock-postgres            | 2.61 kB  | 2.86 kB  |
| drizzle-dialect           | 303 B    | 559 B    |
| fs                        | 674 B    | 930 B    |
| instances-postgres        | 1.12 kB  | 1.37 kB  |
| journal-postgres          | 3.12 kB  | 3.37 kB  |
| kv-lua                    | 995 B    | 1.22 kB  |
| meilisearch               | 1.67 kB  | 1.92 kB  |
| memory                    | 9.76 kB  | 10.01 kB |
| ollama                    | 1.96 kB  | 2.21 kB  |
| pg-extensions             | 6.72 kB  | 6.97 kB  |
| pg-rls                    | 2.76 kB  | 3.01 kB  |
| pg-vault-rls              | 731 B    | 987 B    |
| pglite                    | 822 B    | 1.05 kB  |
| pgvector                  | 21.88 kB | 22.31 kB |
| postgres                  | 1.78 kB  | 2.03 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 1.82 kB  | 2.07 kB  |
| s3-ensure-bucket          | 1.12 kB  | 1.37 kB  |
| signal-engine             | 6.18 kB  | 6.43 kB  |
| signal-live-iter          | 443 B    | 699 B    |
| signal-memory             | 6.22 kB  | 6.47 kB  |
| signal-nats               | 6.70 kB  | 6.95 kB  |
| signal-postgres           | 8.38 kB  | 8.63 kB  |
| signal-redis              | 7.29 kB  | 7.54 kB  |
| signal-retention          | 611 B    | 867 B    |
| vault-1password           | 1.91 kB  | 2.16 kB  |
| vault-aws-secrets-manager | 1.55 kB  | 1.80 kB  |
| vault-azure-key-vault     | 1.55 kB  | 1.80 kB  |
| vault-builtin             | 11.60 kB | 11.85 kB |
| vault-doppler             | 1.57 kB  | 1.82 kB  |
| vault-dotenv-parse        | 715 B    | 971 B    |
| vault-env                 | 856 B    | 1.09 kB  |
| vault-gcp-secret-manager  | 1.81 kB  | 2.06 kB  |
| vault-managed             | 4.95 kB  | 5.20 kB  |
| vault-memory              | 361 B    | 617 B    |
| vault-remote-bag          | 1012 B   | 1.24 kB  |
