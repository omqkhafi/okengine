# Contributing to OKE

Thanks for helping. Drivers are the primary community contribution surface
(unified-theory §29). Everything else — kernel laws, the eight elements, the
ten exports — stays small on purpose.

Read [`AGENTS.md`](./AGENTS.md) before changing apps or this repo. Specs in
`docs/spec/` are authoritative. **If the spec is silent, stop and ask** in the
PR or an issue — do not invent behaviour.

## Propose a change

1. Open an issue (or draft PR) describing the gap against the spec.
2. Prefer a **driver** or **image recipe** over a new concept. New
   infrastructure must bind to an existing element — never a ninth element.
3. Name drivers after **protocols / standards**, not vendors (`postgres`,
   `redis`, `s3`, `smtp` — never `neon`, `minio`, `dragonfly` as driver ids).
   Vendor choice lives in `images`.
4. Keep world access behind `fx`. Direct `node:` / `fetch` / vendor SDKs in
   flow bodies are defects.

## What a PR needs to pass

From the repo root (Bun `>=1.3`):

```bash
bun run typecheck
bun run lint
bun run fmt:check
bun test
bun run gate
bun run ci          # full local gate (integration via CREATE_OKE_INTEGRATION=1)
```

| Check                    | Command                                    | What it enforces                                                            |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------- |
| Types                    | `bun run typecheck`                        | root + create-oke `tsc --noEmit`                                            |
| Lint                     | `bun run lint`                             | oxlint (type-aware)                                                         |
| Format                   | `bun run fmt:check`                        | oxfmt                                                                       |
| Unit / integration tests | `bun test`                                 | Behaviour; set `CREATE_OKE_INTEGRATION=1` for create-oke scaffold/dev gates |
| Four-app doctor          | `bun run gate` → `doctor-diff-examples.ts` | Notes / Linkly / Provisions / Skyport Manifest undeclared breaks            |
| Doc-drift                | `bun run gate` → `doc-drift.ts`            | Claimed code fences vs `examples/*` + mermaid                               |
| Budgets                  | `bun run budgets -- --dry-run`             | AGENTS caps + export regressions                                            |
| Site                     | `bun run site:build`                       | Docs site Next build                                                        |

Tag-push CI runs these checks as **parallel jobs**, then publishes when the `ci` aggregator succeeds.

Doc-drift treats claimed TypeScript fences in `docs/spec/four-applications.md`,
`README.md`, and `site/content/docs/**` as must-match excerpts from
`examples/*`. If you change an example, update the fences (or the example) in
the same PR.

## Writing a driver

See [`docs/guides/writing-a-driver.md`](./docs/guides/writing-a-driver.md) for a
complete worked example against the real ClickHouse **runs** driver contract.

## Package surface

Published packages:

- `okengine` — framework (`oke` CLI)
- `create-oke` — scaffold CLI

Starters live in `templates/*`; teaching apps in `examples/*`. Do not expand the
ten public exports without a spec change.
