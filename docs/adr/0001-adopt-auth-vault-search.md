# ADR 0001 — Adopt auth, vault, and search behind thin adapters

Status: accepted. No code is removed by this note.

The adopt rule in `AGENTS.md` says: do not rebuild software that already exists at high quality. Bind through the runtime's native clients. Name drivers after protocols. New infrastructure is a driver for an existing element, not a ninth element.

Three surfaces in this repo are in-house implementations of problems with mature libraries. This note records the comparison and the adapter shape. It does not pick a vendor or delete the current code.

## Auth — `src/auth`

What we have: hybrid JWT plus a revocable refresh family, ABAC scopes, MFA, two planes (`fx.auth` and `fx.operator`), and a provider seam. The public subpath is `okengine/auth`.

Mature libraries: Better Auth, Lucia, Oslo, and the OAuth/OIDC stacks (Arctic, `oauth4webapi`). They already cover sessions, OAuth, passkeys, and email OTP.

Why it is still in-house: the two planes, tenant-role scope union, and the rule that gates read scopes rather than a principal object are part of the Flow contract. A library session object does not know `plane: "user" | "operator"` or the Manifest gate.

Adapter, if we adopt: keep `fx.auth` / `fx.operator` and the gate scope check. Put the library behind `src/auth` as the session and OAuth driver. Do not let the library become a ninth element or a second public vocabulary.

## Vault — `src/drivers/vault-builtin.ts`

What we have: an encrypted-at-rest, path-addressed store. Boot unseals with `OKE_VAULT_MASTER_KEY`, snapshots secrets into a synchronous bag, and degrades to that bag when the backend is sealed or missing.

Mature libraries: HashiCorp Vault, OpenBao, and cloud secret managers. The driver id stays `vault` (the protocol), not a vendor name.

Why it is still in-house: local `oke dev` has to boot with no network and no operator login. The built-in store is that path. The degradation rule (uninitialized vault does not kill boot) is ours.

Adapter, if we adopt: a `vault` driver that speaks the Vault HTTP API, next to the built-in driver. `fx.vault.get(name)` stays the only read in a Flow. The driver id is not `hashicorp`.

## Search — `src/elements/store/search-bm25.ts` and `search-lsh.ts`

What we have: BM25F (Robertson–Zaragoza, field weights applied before saturation) and an LSH helper for similarity. They score inside the process.

Mature libraries: Meilisearch, Postgres `tsvector`, and SQLite FTS5. The repo already pins Meilisearch as an index image. The index facet is the element; BM25 is one scorer.

Why it is still in-house: the in-process scorer has no network hop and no extra process for tests. FTS5 and Meilisearch are the better default once the corpus or the query shape outgrows a single process.

Adapter, if we adopt: keep `store.index` and `fx.store(index).search`. Point the index driver at Meilisearch or FTS5. Leave BM25 as the in-process fallback, not as a second search API.

## Decision

Keep the three implementations. The next change, when one of them hurts, is a protocol-named driver behind the existing element. That change does not add a public noun and does not delete the in-house path until the adapter passes the same tests.
