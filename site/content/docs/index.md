---
title: "Documentation"
description: "One law. Eight elements. Ten exports."
source: "docs/spec/unified-theory.md"
---

Welcome to the okengine handbook. Start with **Get Started** if you are new; use **Learn** for progressive teaching apps; open **Elements** or **Console** when you need a reference page.

## The one law

> **Every backend behavior is a Flow: `on(Trigger) → Effects`.**

There are no separate species called "endpoints", "handlers", "consumers", "jobs", "subscribers", or "workflows". There is one species — the **Flow** — and triggers are typed values:

```typescript
on(http.post("/bookings"), createBooking);      // "an API endpoint"
on(every("10m"), expireStale);                  // "a cron job"
on(orderPlaced, sendReceipt);                   // "a queue consumer"
on(db.table(users).changed("email"), reverify); // "a CDC trigger"
```

One law → one mental model → one documentation page → one hook pipeline → one trace shape → one thing for an AI agent to learn.

**Learning OKE is learning one sentence.**


## Recommended path

1. [Introduction](/docs/get-started/introduction) — one law, eight elements, ten exports
2. [Installation](/docs/get-started/installation) — `bun add` + `create-oke`
3. [Basic Usage](/docs/get-started/basic-usage) — first flows, client, and tests
4. [Notes](/docs/learn/notes) — full Basic teaching walkthrough

## Browse by topic

- [Comparison](/docs/get-started/comparison) — vs Hono, Elysia, Encore.ts, iii
- [Elements](/docs/elements/flow) — Flow → AI, one page each
- [Console](/docs/console/overview) — seventeen panels from the Manifest
- [CLI Reference](/docs/cli) — `oke` and `create-oke`
- [AI Resources](/docs/ai/resources) — AGENTS.md, MCP `:6535`, `/llms.txt`
