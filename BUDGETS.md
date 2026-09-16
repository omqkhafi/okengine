# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.21.0 · measured 2026-09-16T21:36:53.290Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes hard/optional externals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 16.99 kB  | 17.00 kB  |
| Client runtime                  | 4.99 kB   | 5.00 kB   |
| Console initial load            | 345.33 kB | 700.00 kB |
| Cold start on Bun               | 20.922 ms | 75.000 ms |
| p99 routing overhead            | 0.001 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 45.56 kB  | 46.47 kB  |
| HTTP ping app (raw, externals)  | 131.68 kB | 134.31 kB |

## Exports

|                | Measured  | Ceiling   |
| -------------- | --------- | --------- |
| okengine       | 103.47 kB | 105.54 kB |
| ai             | 13.23 kB  | 13.49 kB  |
| auth           | 18.85 kB  | 19.23 kB  |
| channel        | 7.75 kB   | 8.00 kB   |
| client         | 8.86 kB   | 9.11 kB   |
| client-react   | 11.95 kB  | 12.20 kB  |
| client/auth    | 8.59 kB   | 8.84 kB   |
| client/explain | 1.10 kB   | 1.35 kB   |
| clock          | 18.32 kB  | 18.68 kB  |
| compiler       | 22.57 kB  | 23.02 kB  |
| config         | 1.21 kB   | 1.46 kB   |
| console        | 170.65 kB | 174.06 kB |
| full           | 113.75 kB | 116.03 kB |
| gate           | 4.53 kB   | 4.78 kB   |
| http           | 47.10 kB  | 48.04 kB  |
| i18n           | 5.12 kB   | 5.37 kB   |
| journal        | 3.02 kB   | 3.27 kB   |
| kernel         | 53.58 kB  | 54.65 kB  |
| mcp            | 9.65 kB   | 9.90 kB   |
| okid           | 1.24 kB   | 1.49 kB   |
| plugins        | 35.54 kB  | 36.25 kB  |
| runs           | 9.79 kB   | 10.04 kB  |
| signal         | 1.26 kB   | 1.51 kB   |
| store          | 34.43 kB  | 35.12 kB  |
| test           | 22.19 kB  | 22.64 kB  |
| testing        | 22.19 kB  | 22.64 kB  |
| vault          | 12.75 kB  | 13.01 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 7.82 kB  | 8.07 kB |
| anonymous | 5.68 kB  | 5.93 kB |
| magicLink | 6.88 kB  | 7.13 kB |
| otp       | 8.95 kB  | 9.20 kB |
| twoFactor | 8.96 kB  | 9.21 kB |
| passkey   | 7.33 kB  | 7.58 kB |

### OAuth

|          | Measured | Ceiling  |
| -------- | -------- | -------- |
| oauth    | 13.72 kB | 13.99 kB |
| mcpOauth | 8.96 kB  | 9.21 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 4.58 kB  | 4.83 kB |
| cors        | 4.42 kB  | 4.67 kB |
| csrf        | 4.03 kB  | 4.28 kB |
| ipAllowlist | 4.11 kB  | 4.36 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 3.94 kB  | 4.19 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 4.24 kB  | 4.49 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 72.45 kB | 73.90 kB |
| ai-anthropic              | 1.06 kB  | 1.31 kB  |
| ai-mock                   | 1.05 kB  | 1.30 kB  |
| ai-openai-compatible      | 1.88 kB  | 2.13 kB  |
| cdc-outbox                | 2.90 kB  | 3.15 kB  |
| channel-console           | 701 B    | 957 B    |
| channel-fcm               | 974 B    | 1.20 kB  |
| channel-msegat            | 746 B    | 1002 B   |
| channel-resend            | 387 B    | 643 B    |
| channel-sently-map        | 434 B    | 690 B    |
| channel-smtp              | 468 B    | 724 B    |
| channel-sndr              | 453 B    | 709 B    |
| channel-taqnyat           | 741 B    | 997 B    |
| channel-taqnyat-mail      | 452 B    | 708 B    |
| channel-taqnyat-whatsapp  | 833 B    | 1.06 kB  |
| channel-unifonic          | 763 B    | 1019 B   |
| channel-wa-cloud          | 809 B    | 1.04 kB  |
| channel-webpush           | 937 B    | 1.17 kB  |
| clock-postgres            | 2.92 kB  | 3.17 kB  |
| drizzle-dialect           | 303 B    | 559 B    |
| external                  | 262 B    | 518 B    |
| fs                        | 674 B    | 930 B    |
| instances-postgres        | 1.38 kB  | 1.63 kB  |
| journal-postgres          | 3.35 kB  | 3.60 kB  |
| kv-lua                    | 995 B    | 1.22 kB  |
| meilisearch               | 1.74 kB  | 1.99 kB  |
| memory                    | 9.81 kB  | 10.06 kB |
| oauth-apple               | 3.29 kB  | 3.54 kB  |
| oauth-discord             | 1.52 kB  | 1.77 kB  |
| oauth-facebook            | 1.53 kB  | 1.78 kB  |
| oauth-figma               | 1.51 kB  | 1.76 kB  |
| oauth-github              | 1.58 kB  | 1.83 kB  |
| oauth-google              | 2.88 kB  | 3.13 kB  |
| oauth-microsoft           | 2.99 kB  | 3.24 kB  |
| oauth-oidc                | 2.68 kB  | 2.93 kB  |
| oauth-shared              | 1.95 kB  | 2.20 kB  |
| oauth-x                   | 1.52 kB  | 1.77 kB  |
| oauth2-common             | 643 B    | 899 B    |
| oauth2-token              | 796 B    | 1.03 kB  |
| pg-extensions             | 6.72 kB  | 6.97 kB  |
| pg-rls                    | 4.53 kB  | 4.78 kB  |
| pg-rls-row-passes         | 2.32 kB  | 2.57 kB  |
| pg-vault-rls              | 731 B    | 987 B    |
| pglite                    | 808 B    | 1.04 kB  |
| pgvector                  | 21.11 kB | 21.53 kB |
| postgres                  | 2.60 kB  | 2.85 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 1.82 kB  | 2.07 kB  |
| s3-ensure-bucket          | 1.12 kB  | 1.37 kB  |
| signal-engine             | 6.34 kB  | 6.59 kB  |
| signal-live-iter          | 443 B    | 699 B    |
| signal-memory             | 6.39 kB  | 6.64 kB  |
| signal-nats               | 6.86 kB  | 7.11 kB  |
| signal-postgres           | 9.36 kB  | 9.61 kB  |
| signal-redis              | 7.46 kB  | 7.71 kB  |
| signal-retention          | 611 B    | 867 B    |
| vault-1password           | 1.91 kB  | 2.16 kB  |
| vault-aws-secrets-manager | 1.55 kB  | 1.80 kB  |
| vault-azure-key-vault     | 1.55 kB  | 1.80 kB  |
| vault-builtin             | 10.88 kB | 11.13 kB |
| vault-doppler             | 1.57 kB  | 1.82 kB  |
| vault-dotenv-parse        | 715 B    | 971 B    |
| vault-env                 | 856 B    | 1.09 kB  |
| vault-gcp-secret-manager  | 1.81 kB  | 2.06 kB  |
| vault-managed             | 4.83 kB  | 5.08 kB  |
| vault-memory              | 361 B    | 617 B    |
| vault-remote-bag          | 1012 B   | 1.24 kB  |
