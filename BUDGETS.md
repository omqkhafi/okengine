# Budgets

Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.

_okengine v0.17.2 · measured 2026-08-26T07:07:13.279Z_

Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.

## Core

|                                 | Measured  | Limit     |
| ------------------------------- | --------- | --------- |
| Kernel (edge profile)           | 15.74 kB  | 16.00 kB  |
| Client runtime                  | 3.75 kB   | 4.00 kB   |
| Console initial load            | 348.13 kB | 700.00 kB |
| Cold start on Bun               | 8.871 ms  | 75.000 ms |
| p99 routing overhead            | 0.001 ms  | 1.000 ms  |
| HTTP ping app (gzip, externals) | 42.41 kB  | 43.26 kB  |
| HTTP ping app (raw, externals)  | 123.83 kB | 126.31 kB |

## Exports

|              | Measured  | Ceiling   |
| ------------ | --------- | --------- |
| okengine     | 90.19 kB  | 91.99 kB  |
| ai           | 12.01 kB  | 12.26 kB  |
| auth         | 16.61 kB  | 16.95 kB  |
| channel      | 6.52 kB   | 6.77 kB   |
| client       | 4.01 kB   | 4.26 kB   |
| client-react | 7.98 kB   | 8.23 kB   |
| client/auth  | 559 B     | 815 B     |
| clock        | 16.65 kB  | 16.98 kB  |
| compiler     | 17.71 kB  | 18.06 kB  |
| config       | 1.21 kB   | 1.46 kB   |
| console      | 156.50 kB | 159.63 kB |
| full         | 101.10 kB | 103.12 kB |
| gate         | 4.50 kB   | 4.75 kB   |
| http         | 43.63 kB  | 44.50 kB  |
| i18n         | 4.29 kB   | 4.54 kB   |
| journal      | 2.88 kB   | 3.13 kB   |
| kernel       | 49.66 kB  | 50.65 kB  |
| mcp          | 9.54 kB   | 9.79 kB   |
| okid         | 1.10 kB   | 1.35 kB   |
| plugins      | 26.61 kB  | 27.15 kB  |
| runs         | 9.67 kB   | 9.92 kB   |
| signal       | 1.26 kB   | 1.51 kB   |
| store        | 22.89 kB  | 23.35 kB  |
| test         | 19.86 kB  | 20.26 kB  |
| testing      | 19.86 kB  | 20.26 kB  |
| vault        | 12.77 kB  | 13.02 kB  |

## Plugins

### Auth

|           | Measured | Ceiling |
| --------- | -------- | ------- |
| username  | 6.40 kB  | 6.65 kB |
| anonymous | 4.29 kB  | 4.54 kB |
| magicLink | 5.31 kB  | 5.56 kB |
| otp       | 7.09 kB  | 7.34 kB |
| twoFactor | 5.03 kB  | 5.28 kB |
| passkey   | 5.70 kB  | 5.95 kB |

### oauth

|       | Measured | Ceiling  |
| ----- | -------- | -------- |
| oauth | 12.67 kB | 12.92 kB |

### Security

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| headers     | 4.04 kB  | 4.29 kB |
| cors        | 3.88 kB  | 4.13 kB |
| csrf        | 3.49 kB  | 3.74 kB |
| ipAllowlist | 3.57 kB  | 3.82 kB |

### Ops

|                 | Measured | Ceiling |
| --------------- | -------- | ------- |
| maintenanceMode | 3.39 kB  | 3.64 kB |

### Perf

|             | Measured | Ceiling |
| ----------- | -------- | ------- |
| compression | 3.70 kB  | 3.95 kB |

## Drivers

|                           | Measured | Ceiling  |
| ------------------------- | -------- | -------- |
| drivers                   | 73.42 kB | 74.89 kB |
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
| pg-rls                    | 2.76 kB  | 3.01 kB  |
| pg-vault-rls              | 731 B    | 987 B    |
| pglite                    | 822 B    | 1.05 kB  |
| pgvector                  | 21.88 kB | 22.31 kB |
| postgres                  | 1.82 kB  | 2.07 kB  |
| redis                     | 2.00 kB  | 2.25 kB  |
| s3                        | 1.82 kB  | 2.07 kB  |
| s3-ensure-bucket          | 1.12 kB  | 1.37 kB  |
| signal-engine             | 6.18 kB  | 6.43 kB  |
| signal-live-iter          | 443 B    | 699 B    |
| signal-memory             | 6.22 kB  | 6.47 kB  |
| signal-nats               | 6.70 kB  | 6.95 kB  |
| signal-postgres           | 9.08 kB  | 9.33 kB  |
| signal-redis              | 7.29 kB  | 7.54 kB  |
| signal-retention          | 611 B    | 867 B    |
| vault-1password           | 1.91 kB  | 2.16 kB  |
| vault-aws-secrets-manager | 1.55 kB  | 1.80 kB  |
| vault-azure-key-vault     | 1.55 kB  | 1.80 kB  |
| vault-builtin             | 11.63 kB | 11.88 kB |
| vault-doppler             | 1.57 kB  | 1.82 kB  |
| vault-dotenv-parse        | 715 B    | 971 B    |
| vault-env                 | 856 B    | 1.09 kB  |
| vault-gcp-secret-manager  | 1.81 kB  | 2.06 kB  |
| vault-managed             | 4.95 kB  | 5.20 kB  |
| vault-memory              | 361 B    | 617 B    |
| vault-remote-bag          | 1012 B   | 1.24 kB  |
