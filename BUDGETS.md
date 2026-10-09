# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.24.1 · measured 2026-10-09T23:52:57.756Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). An absolute sample also fails when it reaches 2× its last committed value and that multiple is still under the cap (cold start, and any other absolute row with the same headroom). Cold start keeps the best of five rounds and confirms a failure once, so one noisy run does not fail. Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes hard/optional externals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 14.49 kB  | 17.00 kB  |
| Decision module                 | 5.98 kB   | 5.98 kB   |
| Client runtime                  | 5.10 kB   | 6.00 kB   |
| Console initial load            | 345.53 kB | 700.00 kB |
| Cold start on Bun               | 9.868 ms  | 75.000 ms |
| p99 routing overhead            | 0.000 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 45.59 kB  | 46.50 kB  |
| HTTP ping app (raw, externals)  | 133.61 kB | 136.29 kB |

## Exports

|                | Measured  | Ceiling   |
| -------------- | --------- | --------- |
| okengine       | 111.87 kB | 114.10 kB |
| ai             | 19.59 kB  | 19.99 kB  |
| auth           | 18.47 kB  | 18.84 kB  |
| channel        | 7.86 kB   | 8.11 kB   |
| client         | 8.98 kB   | 9.23 kB   |
| client-react   | 13.70 kB  | 13.97 kB  |
| client/agent   | 1.62 kB   | 1.87 kB   |
| client/auth    | 8.69 kB   | 8.94 kB   |
| client/explain | 1.10 kB   | 1.35 kB   |
| clock          | 17.81 kB  | 18.17 kB  |
| compiler       | 31.92 kB  | 32.56 kB  |
| config         | 1.23 kB   | 1.48 kB   |
| console        | 176.40 kB | 179.92 kB |
| full           | 127.43 kB | 129.98 kB |
| gate           | 4.52 kB   | 4.77 kB   |
| http           | 47.09 kB  | 48.04 kB  |
| i18n           | 5.51 kB   | 5.76 kB   |
| journal        | 5.49 kB   | 5.74 kB   |
| kernel         | 53.18 kB  | 54.25 kB  |
| mcp            | 11.77 kB  | 12.02 kB  |
| okid           | 742 B     | 998 B     |
| plugins        | 36.13 kB  | 36.85 kB  |
| runs           | 9.37 kB   | 9.62 kB   |
| signal         | 1.29 kB   | 1.54 kB   |
| store          | 37.24 kB  | 37.98 kB  |
| test           | 53.72 kB  | 54.80 kB  |
| testing        | 53.72 kB  | 54.80 kB  |
| vault          | 13.15 kB  | 13.42 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 7.29 kB  | 7.54 kB |
| anonymous | 5.13 kB  | 5.38 kB |
| magicLink | 6.33 kB  | 6.58 kB |
| otp       | 8.51 kB  | 8.76 kB |
| twoFactor | 8.42 kB  | 8.67 kB |
| passkey   | 6.80 kB  | 7.05 kB |

### OAuth

|          | Measured | Ceiling  |
| -------- | -------- | -------- |
| oauth    | 13.18 kB | 13.44 kB |
| mcpOauth | 8.39 kB  | 8.64 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 4.00 kB  | 4.25 kB |
| cors        | 3.83 kB  | 4.08 kB |
| csrf        | 3.45 kB  | 3.70 kB |
| ipAllowlist | 3.53 kB  | 3.78 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 3.35 kB  | 3.60 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 3.66 kB  | 3.91 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 84.01 kB | 85.69 kB |
| affected-rows             | 316 B    | 572 B    |
| ai-anthropic              | 1.92 kB  | 2.17 kB  |
| ai-mock                   | 1.21 kB  | 1.46 kB  |
| ai-openai-compatible      | 2.11 kB  | 2.36 kB  |
| ai-preconnect             | 265 B    | 521 B    |
| cdc-outbox                | 2.36 kB  | 2.61 kB  |
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
| clock-postgres            | 3.50 kB  | 3.75 kB  |
| drizzle-dialect           | 303 B    | 559 B    |
| external                  | 262 B    | 518 B    |
| fs                        | 674 B    | 930 B    |
| instances-postgres        | 1.79 kB  | 2.04 kB  |
| journal-postgres          | 10.48 kB | 10.73 kB |
| kv-lua                    | 995 B    | 1.22 kB  |
| meilisearch               | 1.88 kB  | 2.13 kB  |
| memory                    | 9.94 kB  | 10.19 kB |
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
| pg-ddl                    | 752 B    | 1008 B   |
| pg-extensions             | 6.72 kB  | 6.97 kB  |
| pg-rls                    | 5.11 kB  | 5.36 kB  |
| pg-rls-row-passes         | 2.32 kB  | 2.57 kB  |
| pg-vault-rls              | 731 B    | 987 B    |
| pglite                    | 808 B    | 1.04 kB  |
| pgvector                  | 21.96 kB | 22.40 kB |
| postgres                  | 3.11 kB  | 3.36 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 1.82 kB  | 2.07 kB  |
| s3-ensure-bucket          | 1.12 kB  | 1.37 kB  |
| signal-engine             | 5.73 kB  | 5.98 kB  |
| signal-live-iter          | 443 B    | 699 B    |
| signal-memory             | 5.77 kB  | 6.02 kB  |
| signal-nats               | 6.24 kB  | 6.49 kB  |
| signal-postgres           | 9.58 kB  | 9.83 kB  |
| signal-redis              | 9.50 kB  | 9.75 kB  |
| signal-retention          | 611 B    | 867 B    |
| vault-1password           | 2.05 kB  | 2.30 kB  |
| vault-aws-secrets-manager | 1.55 kB  | 1.80 kB  |
| vault-azure-key-vault     | 1.55 kB  | 1.80 kB  |
| vault-builtin             | 11.73 kB | 11.98 kB |
| vault-doppler             | 1.70 kB  | 1.95 kB  |
| vault-dotenv-parse        | 715 B    | 971 B    |
| vault-env                 | 856 B    | 1.09 kB  |
| vault-gcp-secret-manager  | 1.81 kB  | 2.06 kB  |
| vault-managed             | 4.98 kB  | 5.23 kB  |
| vault-memory              | 361 B    | 617 B    |
| vault-remote-bag          | 1.12 kB  | 1.37 kB  |
