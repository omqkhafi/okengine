---
name: oke-perf
description: >-
  Detects and fixes okengine performance drift before a release. Runs
  `bun run budgets`, diffs the result against the last committed
  budgets.json, flags metrics that moved even when CI still passes,
  bisects to the causing commit, and fixes it with a lazy import,
  createDebouncedRunner, or memoization. Use before `bun run bump`,
  when cutting a release, or when the user asks for `/oke-perf`.
  Do not run after an ordinary implementation.
---

# OKE perf — drift before a release

CI fails a real regression (absolute caps, the 2× ceiling on absolute samples that still sit under the cap, and export +2% / +256 B). This skill catches the moves those gates still allow, and fixes them before `bun run bump`.

Canonical user prompt:

```text
/oke-perf
```

Also match: before a release, before `bun run bump`, perf drift, budget drift.

**Does not** bump, commit, or post a release. Version bump stays `bun run bump`. Changelog notes are [oke-ship](../oke-ship/SKILL.md).

## When

- The user is cutting a release or asks for `/oke-perf`.
- Not after an ordinary implementation. Kernel/client/compiler/validation edits still use `bun run budgets:core` from [oke-ship](../oke-ship/SKILL.md).

Cold start needs a quiet machine. Pause `bun run dev` and anything else hammering the CPU before measuring.

## Workflow

```
Task:
- [ ] 1. Record HEAD:budgets.json, then run bun run budgets
- [ ] 2. Diff values. Flag noticeable growth, including rows whose gate still passes
- [ ] 3. Re-measure a flagged timing once. Noise stops here
- [ ] 4. Bisect each real flag to the commit that caused it
- [ ] 5. Fix with an existing pattern (lazy import, createDebouncedRunner, memo)
- [ ] 6. Re-measure and report before / flagged / after
- [ ] 7. Add a guard next to the existing ones when this class of drift was unguarded
```

### 1. Measure

From repo root, record the committed snapshot **before** the run overwrites it:

```bash
git show HEAD:budgets.json > /tmp/oke-budgets-before.json
bun run budgets
```

`bun run budgets` writes `budgets.json` and `BUDGETS.md` and exits 1 when a gate fails. A failing exit is a flag, not a reason to stop the diff.

### 2. Flag

Compare `budgets[].value` by `id` against `/tmp/oke-budgets-before.json`. Ignore `measuredAt` and `version`.

Flag a row when any of these is true:

| Rule | Threshold |
| --- | --- |
| Gate failed | `ok: false` on the new snapshot |
| Bytes grew | growth ≥ max(256, 2% of the committed value) |
| Milliseconds grew | growth ≥ max(1 ms, 25% of the committed value) |

A drop is an improvement. Name it in the report. Do not bisect it.

A new id is a baseline. Do not treat the first value as drift.

### 3. Confirm timing noise

Cold start has already printed a phantom ~2× jump on one bad run. Before bisecting a millisecond row, re-measure that row once on a quiet machine (see the probe table). If the second value is back under the flag threshold, it is noise: restore the snapshot (step 6) and do not bisect.

### 4. Bisect

Good commit: the revision that committed the baseline value (`git log -1 --format=%H -- budgets.json`). Bad: `HEAD`.

If that commit is `HEAD`, the drift is in the working tree. Read the diff. Do not bisect.

Bisect with the **one probe** for that id, not `bun run budgets`. `git bisect run` must exit 0 at or below the committed value plus the flag threshold, and exit 1 above it.

| Id | Probe |
| --- | --- |
| `coldStartMedianMs` | `measureColdStartMedianMs` from `src/release/measure.ts` |
| `kernelEdgeGzipBytes` | `measureKernelEdgeGzipBytes` |
| `clientGzipBytes` | `measureClientGzipBytes` (entry chunk) |
| `clientFullGzipBytes` | `measureClientBundle` → `fullGzipBytes` |
| `consoleInitialGzipBytes` | `measureConsoleInitialGzipBytes` |
| `routingP99Ms` | `measureRoutingP99Ms` |
| `httpPingGzipBytes` / `httpPingRawBytes` | `measureHttpPingAppBytes` |
| `export:*` | `measureExportGzipBytes` on that export's entry (`resolveExportBudgetTargets` in `src/release/exports.ts`) |

```bash
git bisect start HEAD <good>
git bisect run bun -e '<probe; process.exit(value > ceiling ? 1 : 0)>'
```

Name the first bad commit in the report. `git bisect reset` when finished.

### 5. Fix

Use a pattern that already exists. Do not add a helper, and do not raise a cap in `src/release/limits.ts`.

| Drift | Pattern | Where it already lives |
| --- | --- | --- |
| Heavy module on a cold path (`zod`, hybrid-search runtime, a new barrel) | `lazyRequire` with a **computed** stem so `Bun.build` cannot inline the target | `src/kernel/lazy-require.ts`. Callers: `loadClientDescriptor` in `src/kernel/app.ts`, `loadSearchRuntime` in `src/elements/store/sql-session.ts` |
| A burst of filesystem events doing the same work | `createDebouncedRunner` | `src/cli/db-auto-push.ts`, used from `src/cli/dev.ts` |
| The same object computed again on an unchanged reference | Memoize (a `WeakMap` keyed by object identity when the input is a schema or flow object) | `schemaTsCache` in `src/kernel/client-descriptor.ts` |

Match the surrounding code. A static `import()` string is still on the graph — the stem has to be computed, the way those callers do it.

### 6. Report

Re-run the same probe, then `bun run budgets` so the snapshot matches the fix.

Report one line per flagged id:

```text
coldStartMedianMs    8.915 ms → 18.200 ms → 9.100 ms    <commit>    lazy client descriptor
```

Columns: id, committed value, flagged value, value after the fix, causing commit, fix. If the second timing run cleared the flag, say noise and leave the commit column empty.

If nothing was flagged, or a flag was noise, restore the snapshot:

```bash
git checkout -- budgets.json BUDGETS.md
```

Leave a post-fix snapshot in the tree when a real fix changed the numbers. Do not commit unless the user asks.

### 7. Guard the next one

When the drift was a class of bug the gates did not name, add the guard beside the ones that already exist. Do not invent a second list.

| What drifted | Add it here |
| --- | --- |
| A heavy module on the `okengine/http` static graph | One entry in `HTTP_STATIC_GRAPH_FORBIDDEN` (`src/release/http-graph.ts`) |
| An absolute sample that can double and still pass its cap | Already covered by `absoluteRegressionCeiling` in `src/release/measure.ts` — no new gate |
| A new entry graph or a new timing that those two do not see | A test next to `src/release/http-graph.test.ts`, using the same forbidden-list shape |

## Done

- [ ] Every flagged metric is noise, or has a causing commit and a before/after number
- [ ] The fix uses `lazyRequire`, `createDebouncedRunner`, or a memo — caps unchanged
- [ ] `budgets.json` is either restored or refreshed from the fixed tree
- [ ] A new heavy module, if that was the cause, is on `HTTP_STATIC_GRAPH_FORBIDDEN`
