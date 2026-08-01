# Changelog

Release history for `okengine`. One section per published tag, in reverse order.
This file is the canonical source: the site's `/changelog` page is derived from
it, so a release is only announced once it is written here.

Upcoming work lives under `## Unreleased`. `bun run bump` promotes that
section into `## v<version> — <YYYY-MM-DD>`. Every bullet belongs to an
`### ✨ Added` / `### ♻️ Changed` / `### 🐛 Fixed` group (also `### ⚠️ Deprecated` · `### 🔥 Removed` · `### 🔒 Security` when needed).

## Unreleased

## v0.6.0 — 2026-08-01

### ✨ Added

- AI tool-calling through the same path as `fx.call` — `fx.ask(prompt, input, {
tools: [flowRef, …] })` and `fx.run(agent)` share one model-driven tool loop;
  each tool is a Flow (capability, Manifest `calls`, Runs portal). No silent
  extra authority for the model.
- Real `fx.stream` — Ollama NDJSON and `openai-compatible` SSE; cancellation
  reuses the ambient `AbortSignal` from `fx.all` / `fx.race` (one channel).
- `AI_RATE_PRESETS` / `aiRateGate("ask" | "agent" | "embed")` — Gate rate
  presets for expensive AI edges (defaults 20 / 10 / 60 per minute,
  `keyBy: "user"`). Cost caps stay on prompt/agent `budget` decls.
- Optional `headers` on AI open options (e.g. OpenRouter `HTTP-Referer` /
  `X-Title`) — still one `openai-compatible` driver, not per-vendor ids.
- Live Ollama tool-calling integration test (gated ask → real tool → ledger
  portal; skip-visible without a reachable Ollama).
- `defineLocale` / `fx.t` — register EN/AR (or any) message catalogs; `fx.t`
  resolves locale → `i18n.default` → key. Request locale comes from
  `Accept-Language` (matched against `oke.config` `i18n.locales`).
  `fx.locale` exposes the active tag; channel `fx.send` defaults to it.
  Starter ships `src/locales/en.ts` + `ar.ts`.
- ICU MessageFormat for `fx.t` (FormatJS `intl-messageformat`) — interpolation,
  cardinal/ordinal plurals, `select` / `selectordinal`, and rich-text tags
  (`<tag>…</tag>` with function values).
- Type-safe message keys — `defineMessages`, `MessagesFor<typeof en>`, and
  `declare module "okengine" { interface Register { messages: typeof en } }`
  so `fx.t` autocompletes keys and rejects typos at compile time.
- Docs — [i18n](/docs/reference/i18n) reference page (ICU catalogs, typed keys,
  locale matching, built-in failure messages vs Channel `{{field}}`).
- `magicLink` / `emailOtp` Channel catalogs include Arabic bodies alongside
  English (`locales: ["en", "ar"]`).
- Built-in EN/AR ICU catalogs for typed failures (`errors.*`) and OKE codes
  (`oke.*.cause` / `oke.*.fix`). `fail` / `fx.fail` attach a localized
  `error.message` from the active request locale; thrown `OkeError` localizes
  cause and fix. Override via `defineLocale`; explicit `{ message }` wins.
- `ollama` AI driver — thin native `POST /api/chat` client for any pulled
  model (`OKE_AI_MODEL` / `ai.model`); documented local-dev default
  `qwen3.5:9b` (balanced starting point, fully overridable; Apple Silicon
  can use `qwen3.5:9b-mlx`). Base URL `http://127.0.0.1:11434` via
  `OKE_AI_URL` / `OLLAMA_HOST`. Unreachable servers throw
  `OllamaUnavailableError` — never a silent mock fallback.
- Ollama Docker recipe (`images.ai: "ollama/ollama"`) — pulls the configured
  model, health-checks, writes `OKE_AI_URL`. Boot resolves `drivers.ai`
  through a shared `aiDriverFor` switch (same class as store.index).
- Live Ollama integration test (real completion; skips visibly without a
  reachable Ollama / explicit Docker opt-in).
- `magicLink` / `emailOtp` deliver challenges via Channel (`fx.send` +
  `auth-magic-link` / `auth-email-otp` templates and English catalog bodies).
  `exposeDevToken` / `exposeDevOtp` stay for local DX without SMTP. `phoneNumber`
  SMS delivery remains deferred.
- Plugin API `.channelCatalog(catalog)` — merge template bodies into boot
  Channel catalog (parallel to `.channelTemplate`).
- Mailpit integration tests prove real SMTP capture of magic-link token/link
  and email OTP (skip with a visible warn when Docker is unavailable).
- `username({ usernamePolicy, passwordPolicy })` — tunable min/max length,
  charset, letter/number/symbol requirements, and reserved names on sign-up.
  Policy failures return `AuthFailed` with `reason: "username_policy"` /
  `"password_policy"` and a `reasons` array (taken usernames stay
  enumeration-safe as `invalid_credentials`).
- `username` default reserved blocklist (`DEFAULT_RESERVED_USERNAMES`) —
  `admin` / `root` / `api` / `auth` / `anonymous` and peers. `reserved: []`
  opts out; a custom list replaces (does not merge).
- `usernamePolicy.extraAllowedChars` — append characters to the default
  (or `allowedChars`) charset without replacing the whole set.
- `usernamePolicy.extraReserved` — append names to the default (or
  `reserved`) blocklist without replacing it.
- `usernamePolicy` shape rules — `mustStartWithLetter`,
  `forbidEdgeSymbols` (default on), `forbidConsecutiveSymbols` (default on).

### ♻️ Changed

- Ollama documented local-dev default model is `qwen3.5:9b` (was
  `qwen3:8b`; same as `qwen3.5:latest` on the [Ollama library](https://ollama.com/library/qwen3.5)).
  On Apple Silicon, set `OKE_AI_MODEL=qwen3.5:9b-mlx` for the MLX build.
  Docker recipe / compose control use the non-MLX tag.
- `openai-compatible` AI driver is the shared chat/completions client for
  OpenAI, Groq, Together, OpenRouter, vLLM, LM Studio, and Ollama `/v1` —
  configure via `baseUrl` + `apiKey` + `model`. apiKey is required only for
  the default OpenAI cloud base; custom bases may omit it. Native `ollama`
  remains the first-class local path.
- Native `ollama` driver adds tools + streaming (`stream: true` NDJSON) on
  `/api/chat` (still fail-loud; never silent mock fallback).
- Effect inference: `fx.ask(…, { tools: […] })` with static Flow refs adds
  them to Manifest `effects.calls`.
- Rebased export/driver budgets after AI depth (tools, stream, rate presets)
  and related Unreleased work; refreshed `budgets.json` / `BUDGETS.md`.
- Rebased the Store-only `oke()` gzip graph baseline (41.4 kB → 50 kB) after
  shared `fx` growth (stream + i18n).
- Rebased the `plugins` export budget after Channel delivery wiring
  (13.84 kB → 14.77 kB), and refreshed the published budgets snapshot.
- Rebased the `plugins` export budget after username policy wiring
  (14.77 kB → 15.54 kB), and refreshed the published budgets snapshot.
- Rebased the `plugins` export budget after username Gate-auth parity
  (15.54 kB → 15.97 kB), and refreshed the published budgets snapshot.
- `username()` sign-up inherits `gate.auth.passwordPolicy`, `password`
  hash knobs, and `breachCheck` (same as email/password Gate auth).
  Explicit plugin opts still override for that method only.

### 🔒 Security

- `Redacted` values in `fx.ask` / stream prompts are masked with
  `[redacted]` before they reach any provider (same class as `fx.log`).

### 🐛 Fixed

- `smtp` channel driver passes sently's `BunAdapter` so real SMTP (Mailpit /
  providers) works under Bun — previously failed with "No socket adapter
  configured".
- Mailpit auth-delivery tests use real `test.skip` when Docker is unavailable
  (never an empty pass).

## v0.5.1 — 2026-08-01

### ♻️ Changed

- Official plugin rename: `securityHeaders()` / `"security-headers"` →
  `headers()` / `"headers"` (options type `HeadersOptions`; config table
  `headers_config`). Docs page was already `/docs/plugins/headers`.
- Rebased the `plugins` export budget after passkey WebAuthn verify
  (13.21 kB → 13.84 kB), and refreshed the published budgets snapshot.
- `site` joins the version lockstep (`bun run bump` updates
  `site/package.json` with `okengine` + `create-oke`).
- Site depends on `@fumadocs/base-ui` (`^`) directly — dropped the
  `fumadocs-ui` npm alias.

### 🔒 Security

- `twoFactor` TOTP verify uses constant-time comparison across the ±1 step
  window (no plain `===` short-circuit).
- `passkey` register / authenticate now require a real WebAuthn ceremony:
  `clientDataJSON` origin + challenge, `authenticatorData` rpId hash, and
  ECDSA P-256 signature against the stored SPKI public key. Presence-only
  authenticate is rejected; challenges are single-use. New option `origins`.
- Exploit-proof HTTP audit tests for all seven Gate auth method plugins
  (rate limits, gate posture, single-use tokens, anonymous non-escalation,
  Channel delivery gap, TOTP compare, passkey signature/origin).

## v0.5.0 — 2026-08-01

### ✨ Added

- `oke({ gate })` — nested Gate bag (`auth`, `policies`, `rateLimit`,
  `unguardedHttp`). Builtin hybrid auth materializes `/auth/*` as real
  Bindings on the same `ensureBoot → doBoot` posture path; `.needs("auth")`
  is satisfied without `.plug(auth())`. Schema customize +
  `oke schema generate` emit real columns; opt-in cookies, kv secondary,
  hooks, `freshAge`, auth rate presets, enumeration-safe credential errors.
  Docs · [Gate](/docs/elements/gate).
- `okengine/client/auth` helpers (`memorySession`, `AUTH_ERROR_CODES`) and
  `okengine/client-react` `useSession` — still one client (`createClient`).
- Gate auth method plugins (`okengine/plugins`): `username`, `anonymous`,
  `magicLink`, `emailOtp`, `phoneNumber`, `twoFactor`, `passkey` — each
  `.needs("auth")` and contributes HTTP Bindings under `/auth/...`.
  Docs · one page per method under [Plugins](/docs/plugins)
  (`username`, `anonymous`, `magic-link`, `email-otp`, `phone-number`,
  `two-factor`, `passkey`).
- Docs · [Client](/docs/reference/client) — `okengine/client` reference
  (`createClient` forms, REST vs RPC, Bearer auth + gate denials,
  elements-from-the-client, envelope helpers, `oke client add`).
- Homepage **Onboard AI** button (hero CTAs) copies a short bootstrap
  prompt pointing at the live `/llms.txt` index and the repo-root
  `AGENTS.md` — distinct from the per-page docs “Copy prompt” action.
- Docs section landings at `/docs/get-started`, `/docs/elements`,
  `/docs/plugins`, `/docs/console`, `/docs/reference`, and `/docs/ai` —
  definition plus Cards routing for direct URLs (not listed in the
  sidebar).
- Site 404 page — branded “No Flow matched” composition with the
  unmatched path, a probing trigger→Effects visual, and home / docs CTAs.
- `gate.scope(name)` — sugar for
  `gate.policy(name, ({ auth }) => auth.scopes.has(name))` (single source
  of truth for the scope string).
- `gate.public` — explicit public sentinel for intentionally
  unauthenticated HTTP surfaces; name `"public"` is reserved.
- `GateBootError` — every HTTP trigger must carry a gate or `gate.public`
  at boot (fail loud). Test-only opt-out: `unguardedHttp: "allow"` when
  `env === "test"` (`createTestApp` opts out for the harness).
- Docs · [Gate](/docs/elements/gate), [fx](/docs/reference/fx),
  [Plugins](/docs/reference/plugins), [Client](/docs/reference/client),
  [Console Gates](/docs/console/gates) — auth posture, `gate.scope` /
  `gate.public`, `fx.principal`, `.needs()`, unguarded vs explicit public.
- `fx.principal` — read-only originating identity for audit; propagates
  across `fx.call` without filling `fx.auth` (authorization stays
  fail-closed).
- Auth password policy (`assertPasswordPolicy`), Bun.password cost knobs
  (`memoryCost` / `timeCost` with Bun argon2id floor), pluggable
  breach-check + `createHibpBreachCheck` (HIBP k-anonymity range API),
  and session idle / absolute / single-session-per-user options on
  `auth()`.
- Plugin `.needs()` resolution at boot (`PluginNeedsError`) for plugin
  names and element/driver ids.
- Plugin element contributions: `.vault()`, `.clock()`, `.signal()`,
  `.gate()`, `.channelTemplate()` — merged into boot options.

### ♻️ Changed

- Root `oke({ auth })` / `oke({ gates })` / `oke({ unguardedHttp })` moved
  to `oke({ gate: { auth, policies, unguardedHttp } })` (hard migrate).
  Console uses `gate.auth` with `http: false` (keeps `/console/session/*`).
- Plugin `.binding()` contributes HTTP Bindings into the app router on
  `.plug()` (auth method plugins); SmartRouter build is deferred until
  first match so plugs can still add routes.
- `fx.metric` recorded as investigated and **declined**: Runs wide events
  already cover per-invocation observability; no parallel counter/gauge API
  (see `reports/2026-07-31-fx-metric-decision.md` and the fx reference).
- Console HTTP bindings auto-attach `gate.public` or
  `console:operator` for auth posture; Gates panel distinguishes
  unguarded vs explicit public.

### 🔒 Security

- HTTP empty gate chains no longer silently public at boot — declare a
  gate or `gate.public`. `unguardedHttp: "allow"` is honoured **only**
  when `env === "test"` (never a production-wide bypass).
- `autoBoot` now defaults to `true` — the first `fetch` / `execute`
  runs full boot (gate posture, vault, capabilities, element pipeline).
  Pre-boot ungated execution requires an explicit
  `oke({ autoBoot: false })` (unit-test escape hatch only). No shipping
  path had been setting `autoBoot: true`; CLI/Console already called
  `.boot()` explicitly, but bare `oke({…}).fetch()` was silently ungated.
- Default password policy enforced on `createOperator` (minLength 12,
  letter + number); tests needing short passwords must pass
  `skipPasswordPolicy: true` explicitly.
- `POST /auth/sign-up/email` maps password-policy / breach-check failures
  to `AuthFailed` (`reason: "password_policy"` | `"password_breached"`)
  instead of an empty `204` from an unhandled throw. Weak passwords were
  never stored; the status alone looked like silent success.

### 🐛 Fixed

- `gate.public` is always seeded into the Gate runtime — attaching
  `.gate(gate.public)` on a trigger no longer denies with
  `Unauthorized` / `unknown gate: public` when the sentinel was not
  also listed in `oke({ gates })`.
- Console `.oke/console.sqlite` sessions persist and hydrate
  `last_active_at` (idle TTL); older DBs gain the column on open.
- Site `next build` no longer fetches Inter from Google Fonts at build
  time: Inter Variable is vendored under `site/app/fonts/` (OFL) and
  loaded via `next/font/local`, so offline / network-restricted CI builds
  cannot fail with a fonts.gstatic.com 403.
- Unhandled throws in HTTP Flows encode as `500 InternalError` — never
  as empty `204` (which `encodeSuccess(undefined)` previously produced).
- Docs · auth method plugin Quick Starts enable `oke({ gate: { auth } })` before
  `.plug(...)` (`.needs("auth")`); Client notes built-in `POST /auth/refresh`;
  Gate docs cover session idle/absolute/`singleSessionPerUser` and
  `createHibpBreachCheck`; drop false Console rate-limit retune claims.
- Homepage element lattice — compact phone layout, stacked chrome, and no
  spotlight/hover chase on coarse pointers (touch).

## v0.4.3 — 2026-07-31

### 🐛 Fixed

- Site search client matches fumadocs 16.14's ZBSearch move: use
  `staticClient` (no custom `@orama/orama` init). Fresh installs were
  failing `next build` typecheck under `useTypeScriptCli`.

## v0.4.2 — 2026-07-31

### 🐛 Fixed

- `bun run bump` updates package/jsr `"version"` fields in place so oxfmt
  compact arrays in `jsr.json` are not rewritten into multi-line form
  (which failed `fmt:check` after the v0.4.1 cut).

## v0.4.1 — 2026-07-31

### 🐛 Fixed

- Competitor-mention gate no longer matches its own comment: the Rust-core
  peer name in the allowlisted split comment is split the same way as the
  search needle.
- Site `next build` with TypeScript 7: enable `experimental.useTypeScriptCli`
  so Next runs the project-local `tsc` instead of the removed JS compiler API,
  and point it at `tsconfig.build.json` so Bun `*.test.ts` files stay out of
  the production typecheck.

## v0.4.0 — 2026-07-31

### ✨ Added

- `Redacted<T>` — a plain value wrapper for secrets at the value level.
  `fx.vault` now returns `Redacted<string>`: printing, logging, or JSON
  serialization yields a fixed placeholder, never the real value; `.reveal()`
  is the one explicit unwrap, called once at the credential boundary (drivers
  unchanged — they take plain strings at boot). `fx.log` (all levels)
  deep-masks any `Redacted` found anywhere in the logged data, nested
  included, on top of the existing boot-registered substring scrub.
  Orthogonal to effect tracking — the Manifest still records secret _names_.
- `fx.using(acquire, release, use)` — scoped resource cleanup that completes
  the structured-concurrency surface. `release` runs exactly once when `use`
  settles or when the ambient abort signal fires (a sibling `fx.race` winner
  or failing `fx.all` branch), reusing the Prompt-57 ALS signal rather than a
  second cancellation channel. Process-local only — not journaled, and not
  for handles held across durable park/resume.
- `oke-deps` agent skill — scoped dependency updates (one package, one
  `package.json`, or all) with Bun + `ncu`, pin/alias guards, and
  install verification. Documented under Skills; linked from `AGENTS.md`.
- `meilisearch` as an opt-in fourth `store.index` driver — full-text,
  typo-tolerant, faceted search as a genuinely different capability from the
  vector ANN drivers (`memory` / `pgvector` / `libsql`). `IndexStore` is now
  a discriminated union on `driverId`, so TypeScript rejects a vector query
  against a text index (and vice versa) at compile time, never at runtime.
  Local mode spawns a `meilisearch` binary from `PATH` with a generated
  master key under `.oke/meilisearch/`; docker/prod uses a
  `getmeili/meilisearch` image recipe. Not the default — `memory` stays the
  default and meilisearch is wired explicitly per env.

### ♻️ Changed

- Collapse diagram (homepage / Why OKE): each element cluster now has a
  labelled ring arc, and the live chips name the active source plus its
  destinations (A → B, C, D) instead of a single anonymous node. Chips sit
  on the node's outward ray, well clear of the group-name band; the
  connector is a technical leader — pin at the node, creeping data dash,
  and on diagonals a bent end that plugs square into the chip edge — and
  collision layout pushes or drops overlapping destinations. Group names ride the arc on a
  textPath so they curve with their cluster; names below the horizontal
  midline run the other way along the arc so they stay upright.
- Get-started docs replace the Comparison page with **Why OKE** — an
  evergreen case around traditional backend pain points (cache invalidation,
  secrets sprawl, hand-rolled headers, bolted-on observability, ad-hoc
  capabilities) and what Manifest / `fx` / Vault / Console / official plugins
  already close. Ambition stated plainly; pre-1.0 maturity kept honest.
- Get-started pages (Introduction, Why OKE, Installation, Basic Usage)
  rewritten to the oke-docs standard: one-rule Callouts, Quick start Steps,
  Learn more / Next Cards, real Troubleshooting Accordions, and source-verified
  claims (corrected stale `--sql postgres` / `pgTable` wording and template
  examples). Prose-density gate now covers `get-started/`.
- Introduction and Why OKE restructured: Introduction teaches Flow → `fx` →
  Manifest → eight elements → ten exports with a real Quick start; Why OKE
  replaces the mega-table with seam-by-seam sections (cache, glue, secrets,
  observability, permissions, local≠prod) plus ambition/maturity.
- Get-started visuals: every get-started page carries a diagram that earns
  its place — Introduction (`FlowShape`, `ManifestPipeline`, `Features`,
  `Vocabulary`), Why OKE (`DriftBoard`, `CollapseBoard`), Installation
  (`Surfaces`, `DevModes`), Basic Usage (`Surfaces`, `FlowShape`, `ClientLoop`).
  Custom `FlowShape` / `DevModes` / `ClientLoop` / `DriftBoard` /
  `CollapseBoard` plus landing reuse registered in the docs MDX map.
- Why OKE refactored around felt pain: six seams written as incidents (the
  cache that lies, the secret that fails in prod, the glue you rewrite, the
  dashboard that doesn't know you, the permission check in the wrong place,
  local≠prod), each closed by what OKE derives. New `DriftBoard` visual shows
  one change propagating two ways — hand-maintained copies scatter versions
  and stay scattered, Manifest derivations flip in sync — replacing the two
  duplicate pins/features tables with one summary table.
- Docs visuals are now micro-simulations of their own physics, not static
  diagrams with a fade-in: a request token traverses the Gate pipeline (every
  third run denied with a cycling typed failure), a probe descends the Vault
  resolution chain (hit cycles layers; every sixth run misses all →
  `VaultBootError`), Flow triggers fire in turn into one Flow, Signal cards
  run once/broadcast/live delivery demos, Clock ticks a metronome vs a cron
  dial, a send travels Channel's consent→locale→fallback→receipts, and
  `fx.ask` is checked against each AI guardrail with verdicts. All driven by
  a shared deterministic beat clock (`useTick` + `BeatPing` in
  `components/docs/reveal.tsx`), hydration-safe, reduced-motion-aware
  (static snapshots), and toned in each element's canonical ink.
- `CollapseBoard` — a compact docs-side telling of the integration curve
  (Why OKE), replacing the 955px landing stepper in the article. The same 40
  concerns on one ring twice: zoo mesh (136 seams) beside the hub collapse
  (48 edges), with the change feed costing one live change in both shapes
  (up to 15 seams re-checked vs always 2 edges). The full CollapseDiagram
  stays on the landing page.
- Bumped root dependencies: `oxc-parser` / `@oxc-project/types` to
  `0.142`, `vite` to `8.2`, Playwright to `1.62.1`, plus patch updates
  for DuckDB, CodeMirror, React types, and `@vitejs/plugin-react`.
- Bumped site dependencies: fumadocs to `16.14` / MDX `15.2.1`, Next to
  `16.2.12`, `cnfast` to `0.1`, TypeScript to `7`, plus patch/minor
  updates for lucide, framer-motion, postcss, and React types.

### 🔥 Removed

- Named peer comparison matrix and head-to-head positioning copy from
  get-started docs, landing attribution comments, and related satellite
  mentions. A `git grep` gate keeps those names out of the tree.
- `infisical` vault driver (`vault-infisical` / `infisicalVaultDriver`) — drop
  the unused SaaS-shaped secrets backend. Vault drivers that remain:
  `env` · `openbao` · `managed` · `memory`.

### 🐛 Fixed

- Site header active-tab underline no longer floats above the border when
  switching surfaces. Replaced the Framer `layoutId` morph (which fought the
  brand-cell width spring) with a single measured bar that only animates
  `x` / `width`.
- Console production builds resolve shared display labels across element panels.
- Animated docs favicons no longer remove Next-managed metadata nodes during navigation.
- `bump-version --dry-run` rehearses cleanly right after a release: an empty
  `## Unreleased` now prints a note instead of failing (real bumps still
  refuse to cut an empty release), so the publish gate stays green in the
  post-release window.

## v0.3.6 — 2026-07-31

### ✨ Added

- `oke-ship` agent skill — after every implementation, append changelog
  notes under `## Unreleased` and sync site docs via `oke-docs`.
  Wired into `AGENTS.md` so sessions close work with changelog + docs.
- `libsql` and `pglite` Store SQL drivers as optional peers. libSQL adds
  native `F32_BLOB` / `vector_top_k` ANN; PGlite provides opt-in
  PostgreSQL + pgvector parity without changing the local SQLite default.
- Real pgvector ANN for PostgreSQL and PGlite: `vector(dims)` storage,
  HNSW with cosine operators, and similarity-ranked search through
  Drizzle's native vector API.
- Optional `description` on element declarations — `store.*`, `signal`,
  `channel.template`, `clock`, `gate.policy` / `gate.rate`,
  `field.*.describe(…)`, and `plugin.table` — extracted into the
  Manifest and preferred as Console titles when set (raw key fallback).
- `fx.all` / `fx.race` — structured concurrency on plain Promises:
  pass thunks, first failure or settle aborts sibling branches via an
  ambient `AbortSignal` (`fx.signal`). No generators or monadic wrapper.
- `fx.retry(fn, { retries, delay, backoff, jitter, when? })` — exponential
  backoff with full jitter. Prefer inside `fx.step` so durable replay
  skips completed work.
- `flow({ retry })` — coarse whole-`do` retry on the same journal session
  (rewinds the durable cursor between attempts).

### ♻️ Changed

- `bun run bump` promotes `## Unreleased` into `## v{next} — {today}`
  (and leaves a fresh empty Unreleased). Changelog notes for unfinished
  work no longer land on an already-shipped version section.
- SQL-backed indexes share the SQL facet's existing connection. PGlite
  remains an explicit dialect-parity choice; measured WASM startup and
  warm CRUD remain meaningfully slower than native SQLite.

### 🐛 Fixed

- `store.index()` now honors `drivers.store.index` at real boot and uses
  the same driver switch in the Console. Explicit `pgvector` or `libsql`
  configuration fails loudly when its SQL engine, extension, or optional
  peer is unavailable instead of silently using memory.

## v0.3.5 — 2026-07-31

### ♻️ Changed

- `bun run ci` is the single local pre-push gate (format, lint, typecheck,
  integration tests, budgets, gate, site). Removed the unused
  `ci:workflow` split.
- Tag-push CI no longer re-runs budgets (local-only); parallel jobs stay
  lint/fmt, typecheck, test, gate, site → publish.
- GitHub Actions runtimes upgraded off deprecated Node 20:
  `actions/checkout@v6`, `oven-sh/setup-bun@v2.2.0`, `actions/setup-node@v6`.

## v0.3.4 — 2026-07-30

### 🐛 Fixed

- Re-release of v0.3.3 so tag CI can publish: OpenBao bootstrap waits for
  Raft `/sys/health` active before policy writes, and the `plugins`
  export budget is rebased after the CORS / IP-allowlist hardening.

## v0.3.3 — 2026-07-30

### ✨ Added

- `ipAllowlist({ trustedProxyDepth })` — how many trusted proxies append to
  `X-Forwarded-For` (default `1`). Client IP is taken that many hops from
  the right, matching how reverse proxies append rather than overwrite.

### ♻️ Changed

- Site logo assets live under `site/public/logo/` (wordmarks + letter
  variants); README and favicon paths follow. The docs site cycles the
  O / K / E favicon letters.
- Rebased the `plugins` export budget after the CORS / IP-allowlist
  hardening (4.45 kB → 4.74 kB), and refreshed the published budgets
  snapshot.

### 🐛 Fixed

- `cors({ origin: "*", credentials: true })` now throws at construction
  (and again if runtime config introduces the pair) instead of reflecting
  the request origin — that rewrite would have granted any site
  credentialed access.
- `ipAllowlist` no longer trusts the leftmost XFF hop (spoofable when
  proxies append). Wrong or non-positive `trustedProxyDepth` fails loud.
- OpenBao bootstrap waits for `/sys/health` active (Raft leader writable)
  after unseal before mounts/policies — fixes flaky restart CI when
  single-node Raft still reports `readonly storage`.

## v0.3.2 — 2026-07-30

### ♻️ Changed

- Rebased the `vault-openbao` export budget after a genuine size increase
  (608 B → 1.06 kB), and refreshed the published budgets snapshot.

### 🐛 Fixed

- Docs skill forbidden-token lists no longer trip the stack-mode and
  removed-driver `git grep` gates (tokens are split the same way the
  gate tests avoid matching themselves).
- Restored the missing `bun run gate` script so CI’s gate job runs again
  (staleness, removed-driver, error-registry, and upgrade codemod checks).
- Renamed and scrubbed the removed-driver gate file so it does not match
  its own forbidden id under case-insensitive search.

## v0.3.1 — 2026-07-30

### ♻️ Changed

- Docs origin cut over from `okengine.vercel.app` to
  [`oke.omqkhafi.dev`](https://oke.omqkhafi.dev). Error links, README,
  scaffold next-steps, site `metadataBase`, and `llms.txt` examples now
  point at the custom domain.

## v0.3.0 — 2026-07-30

### ✨ Added

- Official plugins — first-party extensions shipped inside `okengine`,
  importable from `okengine/plugins` and attached with `.plug()`, built
  entirely on the public plugin API. The set: `securityHeaders()` (full
  helmet.js parity with API-first defaults — the complete secure-headers
  set on every response, failures included, plus a CSP builder with
  report-only mode), `cors()` (preflight `OPTIONS` answered at the edge
  even for paths bound to other methods; closed by default), `csrf()`
  (stateless fetch-metadata defense with an `Origin` fallback — no
  tokens, no cookies), `compression()` (native `Bun.gzipSync` for
  clients that accept gzip, with size and content-type thresholds),
  `maintenanceMode()` (one-flag 503 drain with `Retry-After`,
  allow-listed paths, and an operator bypass header), and
  `ipAllowlist()` (allow/deny rules by client IP at the edge of the
  pipeline). All no-op safely on non-HTTP triggers.
- `configSource()` — runtime-mutable plugin configuration: code as the
  floor, a DB row as the source of truth, and a KV binding as the
  automatic read-through cache. Every official plugin accepts one in
  place of static options; one clock-bound sync flow (declared effects,
  so the fx rule holds) refreshes the in-memory box that hooks read.
  Flip maintenance mode, open a CORS origin, or enable HSTS from the
  database — no redeploy.
- Plugin API: new `.edge(fn)` contribution — handlers for HTTP requests
  that match **no** flow (e.g. CORS preflight for a path bound to
  another method), run in install order before the plain 404, recorded
  as an `edge` intercept capability. The CORS plugin is built on it.
- Kernel: HTTP flows now serialize their outcome into `ctx.response`
  **before** the `onResponse` pipeline stage, so the last stage sees — and
  may replace — the final response, as `InvocationContext.response` always
  documented. Encoder input mirrors the app layer exactly; non-HTTP
  triggers are unchanged.
- Docs MCP: `oke dev` now boots the read-only docs MCP server next to the
  runtime MCP — app :6530 · Console :6533 · MCP :6535 · docs MCP :6536. No
  Bearer token (public documentation). Tools: `oke.docs.search`,
  `oke.docs.get` — agents answer "how do I … in OKE?" from the real pages
  instead of training-data memory. Docs content now ships inside the
  published package so the surface works in installed apps. Boot failure
  (missing content, busy port) skips the surface, never takes `oke dev`
  down.
- Documentation overhaul — all eight element pages rewritten to one
  standard (quick start → contract → per-environment drivers →
  troubleshooting). New sections: Reference (`oke.config.ts` options,
  environment variables, error codes, the full `fx` API, plugin API),
  AI Resources (runtime + docs MCP, agent contracts and skills,
  `llms.txt` endpoints), and a categorized Plugins section (Security ·
  Operations · Performance). CLI Reference and Security moved under
  Reference.

### ♻️ Changed

- Vault: real OpenBao is now the `docker` / `prod` default driver (durable
  single-node Raft, real init/unseal, least-privilege app token). The
  previous age-based driver and its optional peer dependency were removed
  entirely. Single-point-of-failure by design: back up
  `.oke/openbao/unseal.key` to a separate safe location — losing it means
  losing every secret permanently, with no recovery.

## v0.2.9 — 2026-07-29

### ✨ Added

- `store.resource(db, table, opts)` — declarative CRUD factory nested on
  `store`. Expands into five ordinary `flow({…})`s (`list` / `create` / `get` /
  `update` / `remove`) plus `all()`. Sugar over `fx.store(db)`, never new
  physics; the ten exports stay unchanged.
- `http.resource(path, ops)` + `on(mount)` overload — mounts all five verbs
  (list/create on `path`, get/update/remove on `path/:id`) and returns the ops
  bag for `adopt`. Manifest extract expands the multi-bind statically.
- Complete list URL (PostgREST-shaped, UTF-8 values — English, Arabic, …):
  `?cursor=` / `?offset=` / `?limit=` · `?search=` (`?q=` alias) ·
  `?col=op.value` (`eq ne gt gte lt lte like ilike in is`) · `?or=(…)` /
  `?and=(…)` · `?order=col.desc` · `?select=id,title`. Every surface is
  whitelisted by a ColumnScope (`"all" | Column[] | "none"`).
- `fx.json.ok` / `create` / `empty` / `with` — Stripe-style `{ data, meta,
error }` envelope; `create` → 201, `empty` → 204, list pages attach
  top-level `meta` (`nextCursor`, `hasNextPage`, …). `ClientResult` and the
  in-process test client expose `meta`.
- `fx.store(db).page` / `.count`, fluent `.offset()`, and condition-compiler
  support for `inArray` / `isNull` / `isNotNull` (memory driver matched).
- `OkeOptions.registry?: "consume" | "keep" | "ignore"` (default `consume`) —
  isolates the process-wide `on()` bindings registry so a later `oke()` cannot
  inherit another app’s routes. Console uses `ignore`. Proven by
  `registry-isolation.test.ts`.
- `flow({ breaking: true })` / `store.resource({ breaking: true })` —
  acknowledge intentional Manifest contract breaks for `oke doctor --diff`.

### ♻️ Changed

- Notes teaching app rewritten onto `store.resource` + `on(http.resource(…))`
  with cursor pages, multilingual search, filter/order/select, and 201/204
  status tests. Spec, Learn · Notes, Store element docs, README, and homepage
  snippet regenerated.
- Export gzip baselines refreshed for the intentional `store.resource` /
  memory-driver growth (`okengine`, `store`, `console`, `drivers`, `memory`).

### 🐛 Fixed

- Latent `or(...)` silently flattening into AND in the SQL condition compiler
  (parenthesized OR groups; unsupported ops throw).
- Partial `update().set()` no longer re-applies `$defaultFn` to untouched
  columns via `prepareInsertRow`.

## v0.2.8 — 2026-07-29

### ✨ Added

- Abstract store schema: `store.schema.table` + `field.text` / `field.integer`
  (modifiers + `.pii()` / `.sensitive()` / `.retain()`). ORM-agnostic declare
  site; `oke db push|generate|migrate` emits dialect-specific Drizzle
  (`src/schema.generated.ts`) as a pre-step from `src/schema.decl.ts` and/or
  live plugged plugin tables — not a third schema CLI. Hand-written `schema.ts`
  remains the escape hatch. Prompt 42 / OKE1101 / docker-prod never-auto-DDL
  unchanged.
- Store foreign keys and relations: `field.*.references(() => table.col)` and
  `store.schema.relations({ … }, (r) => …)` mirroring drizzle-orm@1.0.0-rc.4
  `defineRelations` (`r.one.*` / `r.many.*` + `from` / `to`). Same emitter
  pre-step writes FK chains + `defineRelations` into `schema.generated.ts`.
  Linkly’s `daily`→`links` relationship is the first real usage. Many-to-many
  is a junction table with two one/many relations — no separate API. Declared
  relations do not change Manifest `reads` (`fx.store` remains single-table).
- Plugin `.table(name, columns?, options?)` accepts `field.*` column maps;
  contributions merge into the same emitter. **`oke db` loads the live app
  entry** (`src/app.ts` / `db.entry`) and merges `app.plugins.tableContributions()`
  at push/generate/migrate time (and on `oke dev` auto-push). **Known v1
  limit:** plugins add whole tables only — no column injection into
  app-owned tables.
- Manifest `$defs/DeclaredColumn` (additive); compiler extracts
  `store.schema.table` columns + PII into `stores.*.tables.*.columns`.
- `oke db push|generate|migrate` — domain schema sync via drizzle-kit
  (distinct from `oke schema generate` core/plugin stubs). Local `oke dev`
  auto-runs `oke db push` when `schema.ts` / `schema.decl.ts` / `app.ts`
  changes (opt out: `--no-db-push` or `db: { autoPush: false }`). Docker/prod
  never auto-apply DDL; missing tables remapped to `OKE1101` with fix
  `oke db migrate`.
- Templates/examples ship `drizzle.config.ts` (`out: ./drizzle`) plus
  `drizzle-kit` as a devDependency.

### ♻️ Changed

- Docs now state the relational-query limit explicitly (investigated, not a
  feature): Drizzle RQB `db.query.*.findMany({ with: … })` is **not**
  supported through `fx` — `fx.store` is a single-table session, so effect
  inference, cache keys, and PII masking stay exact. Compose separate
  single-table `fx.store` reads (or `fx.call`); each table then appears in
  Manifest `reads` / `writes`.
- `create-oke` interactive wizard no longer asks for Store SQL driver; default
  dual-mode (`local: sqlite` · `docker`/`prod: postgres`) stays, with
  `--sql postgres` still opt-in for a pinned `pgTable` scaffold.
- Soft-compat: legacy `dev`/`stack` keys in `oke.config.ts` warn and normalize
  to `local`/`docker`. CLI stack flags remain hard-removed (`--stack`/`-s`,
  `OKE_STACK`, `.env.stack`, `fromStack` — `oke upgrade` rewrites leftovers).

## v0.2.7 — 2026-07-28

### ✨ Added

- `create-oke --sql sqlite|postgres` (wizard prompt too): `postgres` rewrites
  `src/schema.ts` to `pgTable` and pins `oke.config.ts` `store.sql`
  local/docker/prod; default `sqlite` keeps the dual-mode template pins with
  `sqliteTable`.
- Handbook **Get Started → Deploy**: protocols from `oke.config.ts`, connection
  values from `process.env`, staging as a second deploy, `oke docker --prod` /
  `oke start`. Template `.env.example` and READMEs document `DATABASE_URL` /
  `REDIS_URL` vs vault app secrets.
- `resolveConfigEnv` — boot selects `docker` / `prod` / `test` / `local` from
  `OKE_DOCKER` and `NODE_ENV` when `$options.env` is unset (templates no longer
  hardcode `env: "test"`).
- Mailpit and RustFS image recipes for local SMTP catcher / S3-compatible
  object storage under `oke dev --docker`.
- `CONTRIBUTING.md` and `docs/guides/writing-a-driver.md` (ClickHouse runs
  worked example).
- `.env.example` for every template and teaching example, with inline docs.

### 🐛 Fixed

- `docker/.env.docker` is recipe-accurate: Postgres keeps USER/PASSWORD/DB;
  Redis emits PASSWORD (+ `REDIS_URL`) only; S3 uses ACCESS_KEY/SECRET_KEY/
  BUCKET (+ `S3_*` / `AWS_*` aliases and console `UI_URL`); Mailpit emits
  SMTP URL (+ `SMTP_URL`) and UI URL — no fake USER/PASSWORD/DB.

### ♻️ Changed

- `oke.config.ts` driver maps: `dev` → `local`, `stack` → `docker`. Boot uses
  `env: "local"` by default and `env: "docker"` under `OKE_DOCKER=1`.
  Compose credentials write `docker/.env.docker` (legacy project-root
  `.env.docker` still read). Soft-compat for `--stack`/`-s`, `OKE_STACK`,
  `.env.stack`, and `vault.fromStack` is removed — use `--docker`/`-d`,
  `OKE_DOCKER=1`, `docker/.env.docker`, and `vault.fromDocker`.
- Per-project docker stacks offset Mailpit UI (`8025`) and RustFS console
  (`9001`) host ports, so a second `oke dev -d` no longer fails with
  “port is already allocated”.
- `docker/.env.docker` and template `.env.example` files are commented and
  grouped by role (Vault vs compose services) instead of a flat dump.
- `oke dev --local` / `-l` forces laptop drivers for one session;
  `oke dev --docker` / `-d` boots compose infra with the app on host Bun.
- Bare `oke dev`: TTY prompts once (local vs docker) and saves `.oke/mode`;
  non-TTY defaults to `local` with no prompt and no save. Change the default
  with `oke mode local|docker`. A saved `docker` preference that fails to boot
  fails loudly (hint: `oke mode local`) — never silent downgrade.
- `oke upgrade` includes a codemod for the driver-map key rename
  (`dev`→`local`, `stack`→`docker`) and `fromStack`→`fromDocker`.

## v0.2.6 — 2026-07-26

### 🐛 Fixed

- npm release no longer re-enters the release script after publishing
  `okengine` (a package.json script named `publish` is an npm lifecycle hook).
  Renamed to `release`, and `npm publish` now uses `--ignore-scripts` so
  `create-oke` can publish in the same lockstep run.

## v0.2.5 — 2026-07-26

### ♻️ Changed

- Lockstep republish: npm rejected a second `okengine@0.2.4` publish, so
  `create-oke@0.2.4` never landed on npm. Bump both packages to `0.2.5` so CI
  can publish cleanly (same surface as v0.2.4).

## v0.2.4 — 2026-07-26

### ✨ Added

- `oke dev` prints colored request lines (App / Console / MCP) with flow name,
  duration, and status — gated by `OKE_DEV_REQUEST_LOG` (on by default in
  `oke dev`).
- Soft reload clears request logs and reprints the App / Console / MCP hero
  (`bun --hot --no-clear-screen`), so the banner no longer disappears on save.
- `oke dev` hero uses an OKE wordmark, profile / env / system, and the eight
  elements with active drivers; `Logs` section title; silences
  `/_oke/client.json` regen noise.
- `oke.config.ts` driver maps gain a `stack` profile for `oke dev -s` (local
  server). Boot forces `env: "stack"` under `OKE_STACK=1` so every element uses
  server drivers — not a mix of `dev`/`test` + prod store.
- `defineConfig` copies missing `stack` pins from `prod` (vault pins copy
  like every other element), so server protocols are available under `-s`
  without duplicating every map by hand.
- Durable Console sessions in `.oke/console.sqlite`, so operator login survives
  `oke dev` restarts without clearing cookies.
- `oke dev -s` warns when the `stack` driver profile still points at
  sqlite/memory while stack images run.

### ♻️ Changed

- Generated Docker artefacts default to `docker/` (`.env.stack` stays at project
  root). `oke docker --out` still overrides the directory.
- `oke dev --stack` is infra-only: compose boots role services under `docker/`
  without building/running an `app` container; the host Bun process remains the
  app with hot reload.
- Each `oke dev -s` project gets a unique compose name (`oke-dev-<hash>`) and
  host ports, so two apps no longer share one Postgres/Redis; `.env.stack`
  credentials are reused across restarts.
- `oke dev -s` stack log is a short scannable block (project, ports, drivers).
- `oke dev -s` sets `OKE_STACK=1` and binds drivers from the `stack` profile
  (compose-backed store, etc.) so local stack mimics the server, not sqlite.
- Version bump keeps `templates/*` and `examples/*` at `0.0.1` (project seed,
  not framework version).

### 🐛 Fixed

- Public Console flows ignore a stale Bearer so `setup.status` cannot 401 the
  SPA after a process restart.

## v0.2.3 — 2026-07-26

### ✨ Added

- `oke dev` probes app / Console / MCP ports and increments until free
  (Next.js-style), so a busy `:6530` no longer fails the session.
- Default Docker image pins derived from prod drivers when `images` is omitted
  (`postgres` → `postgres:18-alpine`, `redis` → `redis:8-alpine`).
- Durable Console operators under `.oke/console.sqlite` with a stable
  `.oke/console.secret`, so the claim wizard closes permanently across restarts.
- Console wordmark + favicon; site favicon resolve via `app/icon.svg`.

### ♻️ Changed

- Bare `oke` help is commands-only; Flags / JSON / exit-code notes stay on
  `--help`.
- `oke dev` extracts the Manifest from `src/` and feeds the Console on boot and
  on save, so Overview and element panels are no longer empty by default.
- Standard and full templates pin default `images` for `oke dev -s`.

### 🐛 Fixed

- Second `oke dev` run no longer reprints a claim code or leaves Console stuck
  on Loading after the first operator exists.
- Stale Console session tokens are cleared when claim is required again; setup
  status errors surface instead of spinning forever.

## v0.2.2 — 2026-07-26

### ✨ Added

- TTY `create-oke` wizard with optional `bun install` and `oke dev`, plus
  `AGENTS.md` on scaffold (`--agents-md` / `--no-agents-md`).
- Shared docs origin helper and Clack-style terminal chrome for `oke` boot
  logs and the Console claim note.
- Starter `/` welcome flows, and template README / `.gitignore` files.
- Prebuilt Console SPA ships in the published npm/JSR package.

### ♻️ Changed

- Docs links point at [okengine.vercel.app](https://okengine.vercel.app);
  site wordmark replaced with OKE logo assets.
- JSR excludes narrow to Console UI sources so `dist` ships; publish builds
  Console before packing.
- Version bump keeps `templates/*` and `examples/*` at `0.0.1` (project seed,
  not framework version). Root `CLAUDE.md` removed in favor of `AGENTS.md`.

## v0.2.1 — 2026-07-25

### 🐛 Fixed

- Docs site build in CI: remove the nested `site/bun.lock` that made Turbopack
  treat `site/app` as the project root and miss `next`, and pin
  `turbopack.root` to the monorepo root.

## v0.2.0 — 2026-07-25

### ✨ Added

- Docs site at [oke.dev](https://oke.dev) — branded landing, handbook under
  `/docs`, and a `/changelog` page derived from this file.
- Docs MCP on `:6536` with read-only `oke.docs.search` / `oke.docs.get` (Host /
  Origin validated; bodies match on-disk source with frontmatter stripped).
- Machine-readable docs surfaces: `/llms.txt`, `/llms-full.txt`, and
  `/llms.mdx/docs/...`.

### ♻️ Changed

- Console and elements handbook pages ship as MDX; content sync and the docs
  index cover both `.md` and `.mdx`.
- Publish CI triggers on version tags (`v*`) instead of pushes to `main`.
- README points at the live docs site and documents the docs MCP surface.

## v0.1.7 — 2026-07-25

### ✨ Added

- `create-oke` splits clean starters from teaching apps: `templates/*` is what a
  fresh scaffold copies, and `examples/*` stays behind `--from-example`.
- Export-size gate — the published surface is measured against `budgets.json` on
  every run, so a regression fails the build instead of shipping.

### ♻️ Changed

- Elements bind lazily, at first use, rather than at import time. Only what a
  Flow actually touches through `fx` is constructed.

## v0.1.6 — 2026-07-25

### ♻️ Changed

- Publish pipeline prepared for both npm and JSR from one release run.

### 🐛 Fixed

- `bun test` no longer walks `create-oke` templates, which are copied rather
  than executed in place.

## v0.1.4 — 2026-07-25

### ✨ Added

- Dry-run publish shortcuts, so the release path can be rehearsed without
  touching a registry.

## v0.1.3 — 2026-07-25

### ♻️ Changed

- npm and JSR publishing folded into `ci.yml` — one workflow, one gate set.

## v0.1.2 — 2026-07-25

### ♻️ Changed

- Cold-start budget raised to 75 ms, which is what a GitHub Actions runner can
  actually hold. A budget we cannot measure is not a budget.

### 🐛 Fixed

- The cold-start gate runs on a quiet runner, isolated from the parallel suite,
  so its samples measure the kernel and not the neighbours.
- Budget snapshots no longer auto-push; `budgets.json` changes land as reviewable
  commits.

## v0.1.1 — 2026-07-25

First published release. The one law is executable end to end.

### ✨ Added

- `fx`, the single door to the outside world, and the kernel that makes
  `on(Trigger) → Effects` run.
- All eight elements: Flow, Signal, Store, Clock, Gate, Vault, Channel, AI —
  with protocol-named drivers rather than vendor-named ones.
- Manifest v1: schema, validation, and diff. The AoT compiler extracts it from
  source with oxc, and Standard Schema contracts are validated ahead of time.
- Console on `:6533`, with the Flows causality view, Traces and its folded
  timeline, Runs as wide events over Parquet and DuckDB, Signals, Store, and the
  remaining element panels.
- Agent MCP surface on `:6535`.
- Typed client derived from the `App` type with zero codegen.
- `.plug()` with attachment-point scoping — app, unit, and flow.
- `oke` CLI, infrastructure derived from the Manifest, and the four reference
  apps under `examples/`.
- `create-oke` scaffold plus the release gates that guard every publish.
