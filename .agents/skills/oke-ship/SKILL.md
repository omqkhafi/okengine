---
name: oke-ship
description: >-
  Closes every OKE implementation by updating changelog.md and site docs.
  Use automatically after implementing a feature, fix, refactor, plugin,
  kernel change, CLI change, driver, or any user-visible work — before
  saying the work is done, before commit/release, or when the user asks
  to ship, close out, sync changelog, or update docs after a change.
  Delegates page authoring to the oke-docs skill. Does not bump versions —
  that is `bun run bump`.
---

# OKE Ship — changelog + docs after every implementation

Run this **before** you claim the work is done. Incomplete changelog or silent docs is a defect.

**Does not bump the version.** Changelog notes for unfinished work go under `## Unreleased`. `bun run bump` (version-bump) promotes that section into `## vX.Y.Z — <date>` when you cut the next release.

## When to run

After any implementation that changes behavior, API surface, CLI, plugins, drivers, config, errors, or user-facing docs. Skip only for pure typo/format-only edits with no product impact.

## Workflow (do in order)

```
Task:
- [ ] 1. Diff the change — list user-visible impact
- [ ] 2. Changelog — append under ## Unreleased (create it if missing)
- [ ] 3. Site docs — update or create pages via oke-docs when the surface changed
- [ ] 4. Gates — changelog + docs tests green
```

### 1. Inventory impact

From the diff, list what a user or app author would notice. Map each item to:

| Impact                                  | Changelog group | Docs?                       |
| --------------------------------------- | --------------- | --------------------------- |
| New capability / export / plugin / page | `Added`         | yes if public               |
| Behavior or default change              | `Changed`       | yes if public               |
| Removal                                 | `Removed`       | yes — delete/redirect links |
| Bug fix                                 | `Fixed`         | only if docs lied           |
| Security-relevant                       | `Security`      | yes                         |

If documentation would invent an API the source does not support — **stop and ask** (`AGENTS.md`).

### 2. Changelog (`changelog.md`)

**Upcoming work → `## Unreleased`.** Never append to an already-shipped `## vX.Y.Z` section.

```text
If ## Unreleased is missing (right after the preamble, before the newest ## v…):
  Insert it.

Append bullets under the matching ### group inside Unreleased
(create the group if missing).
```

**Version bump is separate** — when cutting a release:

```bash
bun run bump        # or: bun run bump -- patch|minor|major
# → bumps package.json + jsr.json lockstep
# → renames ## Unreleased → ## v{next} — {today}
# → leaves a fresh empty ## Unreleased for the next cycle
```

Do **not** invent `## v{next}` yourself during oke-ship. Do **not** re-run oke-ship hoping it will bump — it won't.

Site gate: the newest **versioned** release (`## v…`) must equal `package.json` version. `## Unreleased` is skipped by the parser.

Rules:

- Groups only when non-empty, in order: `### ✨ Added` · `### ♻️ Changed` · `### ⚠️ Deprecated` · `### 🔥 Removed` · `### 🐛 Fixed` · `### 🔒 Security`
- Bullets: user/product impact, not a file dump. Match existing voice (short, wrapped lines OK).
- One idea per bullet.

### 3. Site docs

When the change touches a documented surface, update the matching page(s):

| Surface                                                  | Path                             |
| -------------------------------------------------------- | -------------------------------- |
| Elements                                                 | `site/content/docs/elements/`    |
| Official plugins                                         | `site/content/docs/plugins/`     |
| Plugin API / config / errors / fx / env / CLI / security | `site/content/docs/reference/`   |
| AI / MCP / skills / llms.txt                             | `site/content/docs/ai/`          |
| Get started                                              | `site/content/docs/get-started/` |

**Authoring standard:** read and follow [oke-docs](../oke-docs/SKILL.md) for any new page or substantive rewrite (source-verified claims, skeleton, prose density ≤3).

Also:

- Fix broken cross-links you introduced; update `meta.json` / `sidebar-icons.ts` when adding pages.
- Prefer updating the real page over leaving "docs later".
- Internal-only refactors with zero user surface → changelog only (if noteworthy), skip docs.

### 4. Gates

```bash
# from site/
bun test ./lib/changelog.test.ts
bun test lib   # when docs changed
```

Fix every failure before finishing.

## Done checklist

- [ ] Notes under `## Unreleased`, not under a released `## v…` section
- [ ] User-facing surfaces documented (or explicitly N/A)
- [ ] Docs authored via oke-docs when pages were created/rewritten
- [ ] Changelog + docs gates pass
- [ ] Version bump deferred to `bun run bump` when cutting the release
