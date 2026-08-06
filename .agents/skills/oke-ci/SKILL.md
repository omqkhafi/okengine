---
name: oke-ci
description: >-
  Runs `bun run ci` (local pre-push gate) and fixes every failure until green.
  Use when the user asks to run CI, fix CI, make CI pass, pre-push check, or
  `/oke-ci`; also after a large implementation before claiming the work is done
  when they want the full local gate (fmt, lint, typecheck, tests, budgets,
  gate, site build).
---

# OKE CI — run and fix until green

One command. Fix what fails. Re-run until exit 0. Do not stop after the first red check unless blocked on credentials/Docker the suite already skip-visibles.

## Run

From repo root:

```bash
bun run ci
```

That is `bun scripts/ci.ts` — **sequential**; it stops at the first failing check.

## Checks (in order)

| #   | Label      | Command                           | Typical fix                                                                                                                                                                        |
| --- | ---------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Budgets    | `bun run budgets -- --dry-run`    | Shrink export or rebase snapshot via release/publish flow — no silent budget lies. Cold start needs a quiet machine (pause `bun:dev` / heavy load); it runs first on purpose       |
| 2   | Format     | `bun run fmt:check`               | `bun run fmt` (oxfmt write). If `BUDGETS.md` flips every budgets refresh, the markdown tables must be oxfmt-aligned (see `formatBudgetsMarkdown`)                                  |
| 3   | Lint       | `bun run lint`                    | Fix oxlint findings; do not disable rules casually                                                                                                                                 |
| 4   | Typecheck  | `bun run typecheck`               | Fix `tsc --noEmit` (+ `packages/create-oke` typecheck)                                                                                                                             |
| 5   | Tests      | `bun run test`                    | Fix failing tests; live suites must skip-visible, never silent green. Docker live needs `OKE_TEST_DOCKER=1`; Ollama live needs `OKE_TEST_OLLAMA_URL` or `OKE_TEST_OLLAMA_DOCKER=1` |
| 6   | Gate       | `bun run gate` (`PUBLISH_GATE=1`) | Doc-staleness, competitor-mention, vault-driver-removal, errors registry, upgrade codemods, npm pack + jsr publish dry-run                                                         |
| 7   | Site build | `bun run site:build`              | Fix MDX/docs build under `site/` (prose density, fumadocs, links)                                                                                                                  |

## Workflow

```
Task:
- [ ] 1. bun run ci
- [ ] 2. On failure: note which label failed + the error
- [ ] 3. Fix root cause (prefer product fix over weakening the gate)
- [ ] 4. Re-run bun run ci (full sequence — later steps can still break)
- [ ] 5. Repeat until CI passed
```

### Fix discipline

- **Format** when Format fails — run `bun run fmt`, then full `bun run ci` again.
- **Budgets / cold start** — pause local `bun:dev` (and anything hammering the CPU) before re-running; do not raise the 75 ms cap to paper over load.
- **Do not** `--no-verify`, skip hooks, or delete/weaken gates to get green.
- **Do not** expand test skips to hide regressions. Integration skips stay skip-visible (`console.log("skip: …")` + `test.skip`).
- Budgets / Gate / Site failures are real — treat them like test failures.
- After user-facing fixes land, still run [oke-ship](../oke-ship/SKILL.md) if changelog/docs were not updated yet (oke-ci does not own ship).

### When a check needs a long run

Use an adequate wait (tests + site build can take minutes). Prefer re-running full `bun run ci` after fixes so earlier checks still hold.

### Done

Only claim done when the final line is **CI passed** (all checks green). Summarize what failed and what you changed — briefly.
