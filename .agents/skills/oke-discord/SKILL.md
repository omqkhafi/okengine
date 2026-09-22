---
name: oke-discord
description: >-
  Writes a Discord-ready okengine release announcement from changelog.md.
  Use when the user asks for a Discord release post, Discord changelog,
  release report for Discord, or `/oke-discord`. NEVER run automatically after
  implementations. Does not bump versions, commit, or post to Discord.
---

# OKE Discord — release announcement copy

Write paste-ready Discord messages for a **published** release. Source of truth is `changelog.md`. Do not invent bullets.

Canonical user prompt:

```text
/oke-discord
```

Also match: `discord release`, `release report for discord`, `discord announcement`.

**Does not** bump, commit, ship docs, or send the message. Version bump is `bun run bump`. Changelog notes for unfinished work are [oke-ship](../oke-ship/SKILL.md).

## When

- After `## vX.Y.Z` exists in `changelog.md` (post-bump).
- User names a version → that section.
- No version → newest `## v…` heading (skip `## Unreleased`).
- Newest heading is only `## Unreleased` → ask whether they want a preview or to bump first. Label a preview clearly.

## Workflow

```
Task:
- [ ] 1. Read package.json version + the matching ## vX.Y.Z in changelog.md
- [ ] 2. Inventory groups (Added / Breaking / Changed / Deprecated / Removed / Fixed / Security) and #### areas
- [ ] 3. Draft Discord messages (see shape below)
- [ ] 4. Split so each paste is under ~1900 characters
- [ ] 5. Return labeled paste blocks only — no extra commentary unless a bullet had to be dropped
```

### 1. Read the release

From `changelog.md`, take the `## v{version} — YYYY-MM-DD` section only. Fold wrapped continuation lines into their bullet (same as the site parser). Ignore `## Unreleased` unless this is an explicit preview.

Changelog URL (docs origin + minor series, not the unsplit index):

```text
https://oke.omqkhafi.dev/changelog/{major}.{minor}
```

`0.20.0` → `https://oke.omqkhafi.dev/changelog/0.20`. Never `okengine.dev`.

Scaffold commands (always, even if the release is not a create-oke drop):

```bash
bunx create-oke@latest my-app              # blank (default)
bunx create-oke@latest my-app -t shorter   # URL shortener
```

### 2. Voice

Normal release tone. One or two lines of product summary under the title, then the changelog, then **try a new app**.

- Do **not** say under development, preview, unstable, or “don’t upgrade because it is WIP”.
- Do **not** write an Upgrade / migration section. Call to action is **create a new project**, not migrate an existing app.
- Breaking changes stay in the body (facts), without “how to upgrade your old app” steps.
- User/product impact. Group related starter/layout bullets. Do not dump files or every internal path unless the changelog names it as the user-facing layout.
- Discord markdown only: `#` / `##` headings, `**bold**`, `` `code` ``, fenced `bash`, `•` lists. No tables (they render poorly).

### 3. Message shape

Number paste blocks **`N / M`**. Discord hard-caps ~2000 characters — aim ≤1900. Split on section boundaries, not mid-bullet.

**1 / M — headline**

```text
# okengine v{X.Y.Z}
{D Mon YYYY}

{One or two sentences: what this release is for.}

```bash
bunx create-oke@latest my-app
bunx create-oke@latest my-app -t shorter
```

Changelog: https://oke.omqkhafi.dev/changelog/{major}.{minor}

---

## Added — {area}

…
```

Date: from the heading `YYYY-MM-DD` → `D Mon YYYY` (e.g. `2026-09-15` → `15 Sep 2026`).

Then, **only non-empty** groups, in this order, each as `## {Group} — {area}`:

| Changelog group        | Discord heading |
| ---------------------- | --------------- |
| `✨ Added`             | Added           |
| `💥 Breaking Changes`  | Breaking         |
| `♻️ Changed`          | Changed         |
| `⚠️ Deprecated`        | Deprecated       |
| `🔥 Removed`           | Removed         |
| `🐛 Fixed`             | Fixed           |
| `🔒 Security`          | Security        |

Keep `####` areas (`Runtime`, `Dev, Keel & create-oke`, `Docs`, …). Split a large group across messages if needed (`Changed — Runtime` then `Changed — shorter / blank / Keel`).

**Last message — try it** (after Docs / Fixed):

```text
## Try it

```bash
bunx create-oke@latest play
cd play
bun run dev
```

URL shortener:

```bash
bunx create-oke@latest play -t shorter
```
```

Omit the shorter stanza only if create-oke no longer ships `-t shorter` (verify in changelog / `packages/create-oke`).

## Boundaries

- Do not post to Discord, commit, or edit `changelog.md`.
- Do not flatten areas into a file list.
- Do not add bullets that are not in that version’s section.
- If a group is huge (starter internals), cluster: layout, contracts, HTTP/gates, store/SQL, Channel — still sourced from the changelog.

## Done

- [ ] Newest (or requested) `## v…` section, not Unreleased
- [ ] Changelog link is `https://oke.omqkhafi.dev/changelog/{major}.{minor}`
- [ ] CTA is scaffold, not upgrade
- [ ] Paste blocks labeled `N / M`, each under ~1900 characters
