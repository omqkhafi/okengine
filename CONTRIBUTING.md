# Contributing to OKE

Thanks for helping. Drivers are the primary community contribution surface
(unified-theory §29). Everything else — kernel laws, the eight elements, the
ten exports — stays small on purpose.

Read [`AGENTS.md`](./AGENTS.md) before changing apps or this repo. Documentation
in `site/content/docs/` is authoritative. **If it is silent, stop and ask** in
the PR or an issue — do not invent behaviour.

## Workflow

The loop is issue → triage → branch → pull request → CI → review → merge → release.

Work sits on one board, [okengine](https://github.com/users/omqkhafi/projects/2), with a roadmap. Every issue and pull request carries the same metadata, and `pr-meta` enforces it.

### Issue types

| Type    | Use                                                       |
| ------- | --------------------------------------------------------- |
| Epic    | A feature that spans more than one pull request           |
| Feature | One pull request                                          |
| Bug     | Behavior that does not match the specification            |
| Task    | Work that is not a feature or a bug, including a docs gap |

Pick the matching form. Blank issues are off. Security reports go to [SECURITY.md](SECURITY.md). Feature ideas start in [Discussions → Ideas](https://github.com/omqkhafi/okengine/discussions/categories/ideas) and become an issue only after triage. Questions go to [Q&A](https://github.com/omqkhafi/okengine/discussions/categories/q-a).

### Epics and sub-issues

An Epic's sub-issues are the steps, one pull request each. When one step needs another, link them with GitHub's blocked-by relationship. A pull request closes a leaf issue (Feature, Bug, or Task). It does not close an Epic. The Epic closes when its sub-issues close.

### Ready

An item is Ready when the body has acceptance points and the item has all of:

- a type
- Priority (P0–P3)
- Size (XS–XL)
- a milestone

Until then it stays in Triage. Backlog means it is accepted and not Ready.

### Branches

Branch from `dev`. Name the branch `type/short-name`, for example `feat/pluggable-decider` or `chore/github-workflow`.

`dev` is the integration branch. `main` is the release branch and stays the default branch. It only accepts pull requests from `dev`, and version tags (`v*`) are cut from it. Do not push directly to `dev` or `main`. A feature branch squashes into `dev`. At release, `dev` merges into `main` with a merge commit, which keeps `dev`'s history and its `Closes #N` commit messages. Issues close on that release, not when the feature pull request lands on `dev`.

### Pull requests

The title is `type(scope): summary`. A breaking change uses `type(scope)!: summary` and the `breaking` label, with a before/after snippet under the 💥 heading.

Exactly one `type:` label, and it matches the title:

| Title      | Label            |
| ---------- | ---------------- |
| `feat`     | `type: feature`  |
| `fix`      | `type: fix`      |
| `docs`     | `type: docs`     |
| `refactor` | `type: refactor` |
| `perf`     | `type: perf`     |
| `test`     | `type: test`     |
| `chore`    | `type: chore`    |

At least one `area:` label. Path matches are applied by the labeler; add one when the paths are not mapped.

The body contains `Closes #N`, or `Refs #N` when the pull request is only part of the issue. The issue is a leaf, it is on the board, and its milestone is the pull request's milestone.

Milestones are the release trains. `0.24` is pluggable deciders. `0.25` is images in decisions. The pull request milestone is the train the change ships in.

`changelog.md` needs an entry under `## Unreleased`, except for `type: chore`, `type: test`, and `type: docs`.

A feature pull request into `dev` is squash. The commit title is the pull request title and the body is the description, and the head branch is deleted. The release pull request from `dev` into `main` is a merge commit. Rebase is off. Do not delete `dev`.

### Board

| View            | What it shows                                                  |
| --------------- | -------------------------------------------------------------- |
| Board           | Open items, columns by Status, grouped by Priority             |
| Current release | Open items in the newest milestone, grouped by Epic            |
| Roadmap         | Epics by start and target date, grouped by Release             |
| Triage          | Status is Triage, or Priority, Size, or a milestone is missing |
| My work         | Assigned to you, and In progress or In review                  |

A new item starts in Triage. An open pull request moves its issue to In review. Merged means the pull request landed on `dev` and the issue is still open. Done means the issue is closed. Issues close when the release reaches `main`, and that close moves them to Done. Done items are archived after 14 days.

### Release

`bun run bump` promotes `## Unreleased` into `## vX.Y.Z`. The release pull request merges `dev` into `main` with a merge commit. That merge closes the issues whose `Closes #N` messages are on `dev`, including the release issue. Pushing the `v*` tag opens the GitHub Release from that section and closes the matching milestone. npm and JSR publish from the release workflow on that tag, not from a pull request.

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

One local pre-push gate from the repo root (Bun `>=1.4.2`):

```bash
bun run ci
```

| Check     | What it runs                   | Enforces                                                                                             |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Format    | `bun run fmt:check`            | oxfmt                                                                                                |
| Lint      | `bun run lint`                 | oxlint                                                                                               |
| Typecheck | `bun run typecheck`            | root + create-oke `tsc --noEmit`                                                                     |
| Tests     | `bun test`                     | Behaviour + create-oke unit tests                                                                    |
| Budgets   | `bun run budgets -- --dry-run` | AGENTS caps + export regressions                                                                     |
| Gate      | `bun run gate`                 | Doc staleness, removed-driver, error registry, codemods, publish pack/JSR dry-run (`PUBLISH_GATE=1`) |
| Site      | `bun run site:build`           | Docs site Next build                                                                                 |

Pull requests and tag pushes run these checks as **parallel jobs** (without `budgets`, which stays local-only). A `v*` tag then publishes when the `ci` aggregator succeeds. The pull request checklist is `bun run check`. `pr-meta` checks the title, labels, milestone, linked issue, and changelog. See [Workflow](#workflow).

## Writing a driver

See [`docs/guides/writing-a-driver.md`](./docs/guides/writing-a-driver.md) for a
complete worked example against the real ClickHouse **runs** driver contract.

## Package surface

Published packages:

- `okengine` — framework (`oke` CLI)
- `create-oke` — scaffold CLI

Notes starters live in `packages/create-oke/templates/{standard,advanced}`. Do
not expand the ten public exports without a spec change.
