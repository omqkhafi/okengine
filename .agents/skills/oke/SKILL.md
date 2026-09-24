---
name: oke
description: OKE agent contract — Flows, eight elements, fx rule, ports. Use when building or changing okengine apps.
---

# OKE

Authoritative project description is [`AGENTS.md`](../../../AGENTS.md) at the repo root. **Do not duplicate it** — read that file.

Quick reminders (details live in `AGENTS.md`):

- Every backend behavior is a Flow: `on(Trigger) → Effects`
- Core programming vocabulary: `on`, `flow`, `call`, `signal`, `store`, `clock`, `gate`, `vault`, `channel`, `ai`, `plugin`
- Invoke contracts on exposures (`http.*` / `call` / `mcp.tool`); emit schemas on Signal/Channel; Flow is `do` only
- One law. Eight elements. One contract.
- All world access goes through `fx`
- AI: `fx.ask` (prompt, repair, budgets) vs `fx.run` (agent, `maxSteps`, `maxCostPerRun`, `stopReason`) vs `fx.decide`. Tool `approval` needs `durable: true`; resolve in the Console or the approval routes, never from MCP. Stream with `fx.json.stream(fx.run(agent, input, { stream: true }))` and follow `GET /agent/runs/:runId/events` (`Last-Event-ID`); client `okengine/client/agent`, React `useAgentRun`. `fx.decide` is exactly one of `review` or `onUncertain: "abstain"`; review only in a durable non-HTTP Flow; autonomy needs `{ maxError, audit }` and comes only from `oke-decisions.lock.json`.
- Ports: Backend `6530` · Console `6533` · app MCP `6535` · docs MCP `6536`

Machine-readable docs:

- Site `/llms.txt` — generated index of documentation pages
- Docs MCP (`POST http://127.0.0.1:6536/mcp`) — `oke.docs.search` / `oke.docs.get`
- App MCP (`:6535`) — live Manifest / runs (Bearer + confirmation for writes)
