# Contributing to OKE

Thanks for helping. Drivers are the primary community contribution surface
(unified-theory §29). Everything else — kernel laws, the eight elements, the
ten exports — stays small on purpose.

Read [`AGENTS.md`](./AGENTS.md) before changing apps or this repo. Documentation
in `site/content/docs/` is authoritative. **If it is silent, stop and ask** in
the PR or an issue — do not invent behaviour.

## Propose a change

1. Open an issue (or draft PR) describing the documentation gap.
2. Prefer a **driver** or **image recipe** over a new concept. New
   infrastructure must bind to an existing element — never a ninth element.
3. Name drivers after **protocols / standards**, not vendors (`postgres`,
   `redis`, `s3`, `smtp` — never `neon`, `minio`, `dragonfly` as driver ids).
   Vendor choice lives in `images`.
4. Keep world access behind `fx`. Direct `node:` / `fetch` / vendor SDKs in
   flow bodies are defects.

## What a PR needs to pass

One local pre-push gate from the repo root (Bun `>=1.3.14`):

```bash
bun run ci
```

| Check     | What it runs                        | Enforces                                                                                             |
| --------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Format    | `bun run fmt:check`                 | oxfmt                                                                                                |
| Lint      | `bun run lint`                      | oxlint                                                                                               |
| Typecheck | `bun run typecheck`                 | root + create-oke `tsc --noEmit`                                                                     |
| Tests     | `CREATE_OKE_INTEGRATION=1 bun test` | Behaviour + create-oke scaffold integration                                                          |
| Budgets   | `bun run budgets -- --dry-run`      | AGENTS caps + export regressions                                                                     |
| Gate      | `bun run gate`                      | Doc staleness, removed-driver, error registry, codemods, publish pack/JSR dry-run (`PUBLISH_GATE=1`) |
| Site      | `bun run site:build`                | Docs site Next build                                                                                 |

Tag-push CI runs these checks as **parallel jobs** (without `budgets`, which stays local-only), then publishes when the `ci` aggregator succeeds.

## Writing a driver

See [`docs/guides/writing-a-driver.md`](./docs/guides/writing-a-driver.md) for a
complete worked example against the real ClickHouse **runs** driver contract.

## Package surface

Published packages:

- `okengine` — framework (`oke` CLI)
- `create-oke` — scaffold CLI

The standard starter lives in `packages/create-oke/template`. Do not expand the
ten public exports without a spec change.
