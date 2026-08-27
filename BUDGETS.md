# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.17.2 · measured 2026-08-27T20:27:55.233Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 15.91 kB  | 16.00 kB  |
| Client runtime                  | 3.94 kB   | 4.00 kB   |
| Console initial load            | 348.13 kB | 700.00 kB |
| Cold start on Bun               | 9.881 ms  | 75.000 ms |
| p99 routing overhead            | 0.001 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 49.45 kB  | 50.37 kB  |
| HTTP ping app (raw, externals)  | 143.99 kB | 146.73 kB |

## Exports

|              | Measured  | Ceiling   |
| ------------ | --------- | --------- |
| okengine     | 97.97 kB  | 99.56 kB  |
| ai           | 12.01 kB  | 12.26 kB  |
| auth         | 16.67 kB  | 16.95 kB  |
| channel      | 6.52 kB   | 6.77 kB   |
| client       | 4.58 kB   | 4.83 kB   |
| client-react | 11.11 kB  | 11.36 kB  |
| client/auth  | 559 B     | 815 B     |
| clock        | 16.70 kB  | 17.04 kB  |
| compiler     | 18.42 kB  | 18.68 kB  |
| config       | 1.21 kB   | 1.46 kB   |
| console      | 163.32 kB | 166.54 kB |
| full         | 108.49 kB | 110.49 kB |
| gate         | 4.53 kB   | 4.78 kB   |
| http         | 50.61 kB  | 51.56 kB  |
| i18n         | 4.29 kB   | 4.54 kB   |
| journal      | 2.88 kB   | 3.13 kB   |
| kernel       | 56.68 kB  | 57.76 kB  |
| mcp          | 9.54 kB   | 9.79 kB   |
| okid         | 1.10 kB   | 1.35 kB   |
| plugins      | 31.92 kB  | 32.50 kB  |
| runs         | 9.67 kB   | 9.92 kB   |
| signal       | 1.26 kB   | 1.51 kB   |
| store        | 24.83 kB  | 25.06 kB  |
| test         | 19.86 kB  | 20.26 kB  |
| testing      | 19.86 kB  | 20.26 kB  |
| vault        | 12.77 kB  | 13.02 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 6.47 kB  | 6.66 kB |
| anonymous | 4.35 kB  | 4.54 kB |
| magicLink | 5.38 kB  | 5.57 kB |
| otp       | 7.15 kB  | 7.35 kB |
| twoFactor | 5.09 kB  | 5.28 kB |
| passkey   | 5.76 kB  | 5.95 kB |

### OAuth

|          | Measured | Ceiling  |
| -------- | -------- | -------- |
| oauth    | 12.73 kB | 12.92 kB |
| mcpOauth | 8.80 kB  | 9.05 kB  |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 4.07 kB  | 4.32 kB |
| cors        | 3.91 kB  | 4.16 kB |
| csrf        | 3.52 kB  | 3.77 kB |
| ipAllowlist | 3.60 kB  | 3.85 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 3.42 kB  | 3.67 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 3.73 kB  | 3.98 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 73.69 kB | 75.17 kB |
| ai-anthropic              | 979 B    | 1.21 kB  |
| ai-mock                   | 1.05 kB  | 1.30 kB  |
| ai-ollama                 | 1.96 kB  | 2.21 kB  |
| ai-openai-compatible      | 1.77 kB  | 2.02 kB  |
| cdc-outbox                | 2.88 kB  | 3.13 kB  |
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
| memory                    | 9.81 kB  | 10.06 kB |
| oauth-apple               | 3.72 kB  | 3.97 kB  |
| oauth-discord             | 1.52 kB  | 1.77 kB  |
| oauth-facebook            | 1.53 kB  | 1.78 kB  |
| oauth-figma               | 1.51 kB  | 1.76 kB  |
| oauth-github              | 1.58 kB  | 1.83 kB  |
| oauth-google              | 3.34 kB  | 3.59 kB  |
| oauth-microsoft           | 3.47 kB  | 3.72 kB  |
| oauth-oidc                | 3.28 kB  | 3.53 kB  |
| oauth-shared              | 1.94 kB  | 2.19 kB  |
| oauth-x                   | 1.52 kB  | 1.77 kB  |
| oauth2-common             | 643 B    | 899 B    |
| oauth2-token              | 796 B    | 1.03 kB  |
| ollama                    | 1.96 kB  | 2.21 kB  |
| pg-extensions             | 6.72 kB  | 6.97 kB  |
| pg-rls                    | 4.53 kB  | 4.78 kB  |
| pg-rls-row-passes         | 2.32 kB  | 2.57 kB  |
| pg-vault-rls              | 731 B    | 987 B    |
| pglite                    | 822 B    | 1.05 kB  |
| pgvector                  | 21.88 kB | 22.31 kB |
| postgres                  | 2.00 kB  | 2.25 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 1.82 kB  | 2.07 kB  |
| s3-ensure-bucket          | 1.12 kB  | 1.37 kB  |
| signal-engine             | 6.22 kB  | 6.47 kB  |
| signal-live-iter          | 443 B    | 699 B    |
| signal-memory             | 6.26 kB  | 6.51 kB  |
| signal-nats               | 6.74 kB  | 6.99 kB  |
| signal-postgres           | 9.12 kB  | 9.37 kB  |
| signal-redis              | 7.33 kB  | 7.58 kB  |
| signal-retention          | 611 B    | 867 B    |
| vault-1password           | 1.91 kB  | 2.16 kB  |
| vault-aws-secrets-manager | 1.55 kB  | 1.80 kB  |
| vault-azure-key-vault     | 1.55 kB  | 1.80 kB  |
| vault-builtin             | 11.82 kB | 12.07 kB |
| vault-doppler             | 1.57 kB  | 1.82 kB  |
| vault-dotenv-parse        | 715 B    | 971 B    |
| vault-env                 | 856 B    | 1.09 kB  |
| vault-gcp-secret-manager  | 1.81 kB  | 2.06 kB  |
| vault-managed             | 4.95 kB  | 5.20 kB  |
| vault-memory              | 361 B    | 617 B    |
| vault-remote-bag          | 1012 B   | 1.24 kB  |
