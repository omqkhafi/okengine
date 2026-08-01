---
name: oke-docs-update
description: >-
  Syncs existing OKE site docs to match current source after a feature or API
  change. Use when the user says "/oke-docs update site docs", "update site
  docs", or asks to refresh documentation for work just implemented — without
  inventing APIs. Delegates page authoring rules to the oke-docs skill; does
  not bump versions or own the changelog (that is oke-ship).
---

# OKE Docs Update — sync site docs to source

Canonical user prompt (use this skill when it appears):

```text
/oke-docs update site docs
```

Also match plain: `update site docs`, `sync docs to source`, `refresh the docs page`.

**Not a new-page authoring skill.** For greenfield pages or full IA rewrites with no prior change context, use [oke-docs](../oke-docs/SKILL.md) directly. For changelog + docs after shipping code, prefer [oke-ship](../oke-ship/SKILL.md) (it already calls oke-docs).

## Immediately

1. **Read** [oke-docs](../oke-docs/SKILL.md) and follow its workflow for every page you touch (verify from source → skeleton → gates → before/after). Do not skip step 2 of oke-docs.
2. **Inventory** which docs are stale from this conversation / git diff — not the whole site.

## Inventory (required)

Map the change to pages that exist under `site/content/docs/`:

| Change surface                    | Primary page          | Also check                                              |
| --------------------------------- | --------------------- | ------------------------------------------------------- |
| Official plugin (`src/plugins/…`) | `plugins/<name>.mdx`  | `plugins/index.mdx`, related peers, Gate if shared opts |
| Gate / auth                       | `elements/gate.mdx`   | auth method plugin pages                                |
| Element                           | `elements/<name>.mdx` | `reference/fx.mdx` if fx surface moved                  |
| CLI / config / client / security  | `reference/…`         | get-started if install story changed                    |
| Console                           | `console/…`           | —                                                       |

If no page exists and the surface is public — **stop and ask** whether to create one via oke-docs (do not invent).

## Update rules

- Claims come from **current source**, never from the old page or chat memory.
- Prefer **rewrite the affected sections** (options tables, Quick start, troubleshooting, deep sections) over sprinkling notes.
- Fix **related** pages that would otherwise lie (e.g. Gate says an option is email-only when username inherits it).
- Cross-links only to pages that exist; update `meta.json` / index cards when titles or descriptions go stale.
- **No changelog** unless the user also asked to ship — that is oke-ship.
- **No version bump.**

## Done checklist

```
Task:
- [ ] Pages inventory listed (primary + related)
- [ ] Each page verified against source (oke-docs step 2)
- [ ] Written to oke-docs skeleton / density / component rules
- [ ] From site/: bun test lib  → 0 fail
- [ ] From site/: bunx fumadocs-mdx  → compiles
- [ ] Before/after summary for the user (oke-docs step 5)
```

## Authority

`AGENTS.md`: if documentation would claim something the source does not support, **stop and ask**.
