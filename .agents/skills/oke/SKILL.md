---
name: oke
description: OKE agent contract — Flows, eight elements, fx rule, ports. Use when building or changing okengine apps.
---

# OKE

Authoritative project description is [`AGENTS.md`](../../../AGENTS.md) at the repo root. **Do not duplicate it** — read that file.

Quick reminders (details live in `AGENTS.md`):

- Every backend behavior is a Flow: `on(Trigger) → Effects`
- Ten exports: `on`, `flow`, `signal`, `store`, `clock`, `gate`, `vault`, `channel`, `ai`, `plugin`
- All world access goes through `fx`
- Ports: Backend `6530` · Console `6533` · app MCP `6535` · docs MCP `6536`

Machine-readable docs:

- Site `/llms.txt` — generated index of documentation pages
- Docs MCP (`POST http://127.0.0.1:6536/mcp`) — `oke.docs.search` / `oke.docs.get`
- App MCP (`:6535`) — live Manifest / runs (Bearer + confirmation for writes)
