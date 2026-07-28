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
bun test
bun run gate
bun run ci          # before large changes (includes budgets + integration)
```

| Check | Command | What it enforces |
|---|---|---|
| Types | `bun run typecheck` | `tsc --noEmit` |
| Unit / kernel tests | `bun test` | Behaviour + budgets where covered |
| Four-app doctor | `bun run gate` → `doctor-diff-examples.ts` | Notes / Linkly / Provisions / Skyport Manifest undeclared breaks |
| Doc-drift | `bun run gate` → `doc-drift.ts` | Claimed code fences vs `examples/*` + mermaid |
| Error registry / codemods / publish gate | part of `bun run gate` | Stable error codes + upgrade transforms |
| Integration | `bun run test:integration` | Four teaching apps + `create-oke` |
| Budgets | `bun run budgets` / `bun run bench` | Kernel / client / cold-start limits |

PRs that touch Console UI should also note any manual Console smoke
(`bun run test:console:smoke`) when relevant.

## Driver contributions

See **[docs/guides/writing-a-driver.md](./docs/guides/writing-a-driver.md)** for
the real interface contract and a complete worked example (ClickHouse runs
driver). Short checklist:

- Implement the element’s driver interface (`RunsDriver`, `SqlDriver`, …).
- Register in the element’s runtime map.
- Prefer optional peers + dynamic `import()` (or native `fetch`) — no new
  mandatory dependency for apps that never configure the driver.
- Add tests that exercise the fake/injected client path; network tests may
  mock `fetch`.
- Document protocol id + `oke.config` pin example.

## Docs and examples

- Specs: `docs/spec/` (do not contradict without an explicit spec update).
- Teaching apps: `examples/*` (`--from-example`).
- Clean starters: `templates/*` (via `create-oke`).
- Handbook: `site/` (partly generated — run `bun run site:sync` when content
  scripts change).

Doc-drift fails the gate when README / learn pages claim fences that diverge
from the examples. Update both sides together.

## PR hygiene

- Small, reviewable diffs. One concern per PR when possible.
- TSDoc on exported functions, classes, and types.
- No secrets in commits (`.env`, credentials).
- Do not weaken gates, capability tokens, or effect tracking for “convenience”
  adapters — mounted or exported surfaces must keep the same rules.

## License

MIT. By contributing you agree your changes are MIT-licensed with the rest of
the project.
