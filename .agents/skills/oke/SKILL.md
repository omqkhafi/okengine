---
name: oke
description: OKE agent contract — Flows, eight elements, fx rule, ports. Use when building or changing okengine apps.
---

# OKE

Authoritative project description is [`AGENTS.md`](../../../AGENTS.md) at the repo root. **Do not duplicate it** — read that file.

Start with **How to use OKE** in that file (canonical Flow, `fx` surface, app wiring, layout, config). Then the contract laws.

Quick reminders:

- Every backend behavior is a Flow: `on(Trigger) → Effects`
- Body talks to the world only through `fx` (`store` / `emit` / `send` / `vault` / `ask` / `call` / `fail` / `clock`)
- Ten exports: `on`, `flow`, `signal`, `store`, `clock`, `gate`, `vault`, `channel`, `ai`, `plugin`
- Drivers = protocols; vendors live in `images`
- Ports: app `6530` · Console `6533` · app MCP `6535` · docs MCP `6536`
- Copy patterns from `templates/standard` or `examples/notes` — do not invent a parallel handler stack

Machine-readable docs:

- Site `/llms.txt` — generated index of documentation pages
- Docs MCP (`POST http://127.0.0.1:6536/mcp`) — `oke.docs.search` / `oke.docs.get`
- App MCP (`:6535`) — live Manifest / runs (Bearer + confirmation for writes)
