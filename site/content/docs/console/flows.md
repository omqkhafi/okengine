---
title: "Flows"
description: "What exists; call it; read its contract."
source: "docs/spec/console.md"
---

#### 9.1 Flows panel — the causality view

The panel does not use a tree. It renders **the one law itself** as three columns: `Causes ← Flows → Effects`.

**Why not a tree.** Both candidate hierarchies (by unit, by trigger type) pick a single dominant axis, and both classify the wrong object. The useful unit of navigation is the **relation**, not the flow. Our relations are compiler-derived from `fx` and therefore cannot rot — unlike hand-written catalog metadata, and unlike inferred data lineage that tools let you hand-correct.

**Bidirectional traversal:**
- Select a cause → centre shows what it runs → right shows what changes. *(What happens if…?)*
- Select an effect, e.g. a table → centre shows everything that touches it → left shows what triggers those. *(What breaks if I change this?)*
- Select a flow → both sides pin to its exact causes and effects.
- Clicking an effect re-centres on it, walking the graph one hop at a time. The path is a breadcrumb and lives in the URL.

**The tree options survive as facets:** unit grouping becomes the centre column's switchable grouping; trigger types become the left column's grouping. Nothing is discarded.

**Internal flows need no special case** — a flow with no trigger shows its **callers** as causes. The "private" category disappears. A flow with three triggers appears once, with all three highlighted on the left.

##### Centre column — row anatomy

Because the sides carry trigger and effect, the centre carries only identity, state, and "is this interesting right now?". Six elements: status mark (hollow = no traffic in 30 days) · unit-dimmed name · exception-only flags (durable, live, cached, costs money, reads a secret, touches PII — absence is information) · 24 h sparkline · p99 · error rate (an em dash, not a zero).

**Context-adaptive columns.** The column set reshapes with the left-column selection: choose Clock and the centre gains next-run/last-run/drift; choose a Signal and it gains pending/in-flight/DLQ; choose AI and it gains cost, prompt version, eval score. A cost column never appears in a project that uses no AI.

**Attention is a banner, not a re-sort.** Default order is grouped by unit, alphabetical within — stable, so spatial memory can form. A thin strip above the column reads "3 flows erroring · 1 cron overdue · 2 dead letters" and filters on click.

Density: compact (one line) / comfortable (second line = the flow's doc comment). Chevron expands the contract inline; the name opens the drawer over the centre column while both sides stay as context.

##### Right column — effects ranked by reversibility

Ranking is not a matter of taste. Reversibility is the load-bearing distinction in both classical transaction literature and modern agent runtimes: a reversible effect is one the runtime can undo alone; an irreversible one it cannot — a sent email is irreversible. The second axis is externalisation timing: whether the effect commits on call or can be deferred to commit. **Our architecture already embodies this** — `fx.emit` on a Postgres-backed signal commits with the transaction, which is exactly the deferred class.

| Tier | Contents | Treatment |
|---|---|---|
| **Reads** | no world change | dimmed |
| **Writes** | reversible in-transaction | normal weight |
| **Emits** | deferred; commits with the txn, then fans out | normal + fan-out count |
| **External** | channels, AI providers — irreversible | the panel's only accent + outward arrow |
| **Capabilities** | secrets — authority held, not effect caused | separate footer zone |

**This ranking is functional, not decorative** — which is what makes it undisputable:
- `Replay` on a trace containing an external effect is **disabled with an explanation**, or offers a dry run with external effects stubbed.
- A flow with any external effect automatically gains the outward-arrow flag in the centre column.
- A `pii`-tagged resource feeding an external effect is exactly what the compiler rejects — so the UI shows *why* a build failed instead of leaving you to guess.

**Calls are portals, not rows.** `fx.call` targets expand in place to reveal the callee's effects, indented and dimmed, with a global direct/transitive toggle. This answers the security-review question no framework answers today: *what does this request actually touch, in the end?*

**Idle state is an inventory.** With nothing selected, the right column lists every resource in the system under the same tiers, ranked by how many flows touch it — an instant answer to "what state does this system own, and where are the hot spots?" Ubiquitous resources carry a count badge and can be filtered out.

**A rejected alternative, for the record:** moving reads to the left column would give a clean inputs → behaviour → outputs flow, but it splits "what touches the bookings table" across two columns. The semantic unity of a resource outranks the elegance of the dataflow.

#### 9.2 The flow drawer

**The drawer is a workshop, not a document.** Two views, never three:

- **Peek** (default) — covers the centre column only, so causes and effects stay in view. This is a direct dividend of the three-column layout: the drawer never repeats the effects, because they are still on screen.
- **Workbench** — expands over both side columns when you invoke. Only here does a compact effects strip appear in the header, because the right column is now covered.

**Header:** unit-dimmed name · plane badge · flags · deprecation with a real usage count · four actions: **Invoke** (primary), copy client line, open in editor, traces. "Copy client line" yields `await api.bookings.create({ … })` pre-filled with the current request values.

**Contract — a dual form ⇄ JSON editor, synced both ways.** We hold the full schema with its constraints, not just the types, so: `enum` becomes a select, `min/max` becomes a bounded input, nested objects become collapsible groups, arrays become repeatable rows, **and validation happens locally before sending** — the error appears under the field with no network round trip. An empty first field is a failure of imagination: seed a plausible example from the constraints.

**Invoke — three decisions:**
1. **"As whom" is part of the request, not hidden configuration.** Operators hold no application scopes, so they use `console:flows:invoke-as`. The identity picker sits at the same prominence as the request body; burying it in a collapsed section is a security failure, not a layout choice.
2. **One Invoke that adapts to the trigger** — HTTP sends a request, Signal publishes a test message, Clock runs now, Internal calls directly, Durable starts a run whose steps advance live. One law, one button.
3. **Risk level is derived, not configured.** The drawer reads the flow's effect tier: an external effect in production means a real email reaching a human or a real card charge, so it raises the irreversible warning, requires typed confirmation, and records a reason.

**Response:** typed error narrowing (`FlightFull` with `{ seatsLeft: 3 }`, not a bare 400) · the response is diffed against the declared schema, so a missing or extra field from the server is surfaced as a bug rather than swallowed · the trace appears immediately below, closing the loop in one screen instead of across two panels.

**Recent activity** shows a typed error breakdown — `FlightFull 38 · NotFound 5 · Unauthorized 2` — which turns "why is this failing?" from an investigation into a line of reading. Impossible where errors are not part of the contract.

**Save as test** exports the request as a `bun test` case with assertions filled from the actual response: debug it, save it, it never regresses.

**The drawer refuses to:** become a page (the URL stays on the panel; Back closes the drawer, it does not leave) · hide the contract behind a second tab · duplicate the effects in peek view · allow an irreversible production invoke without deliberate friction.
