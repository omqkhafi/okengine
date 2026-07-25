---
title: "Traces"
description: "One timeline across http → store → signal → durable steps."
source: "docs/spec/console.md"
---

#### 9.3 Traces

**The architectural problem:** every tracing tool assumes one synchronous timespan. Ours are asynchronous by construction — an `emit` is consumed in another process, and `fx.clock.sleep("7d")` makes a trace live for a week. A waterfall for a seven-day trace is 99.99% empty space.

**Folded time.** Dead time collapses into a labelled, expandable bar the way a diff folds unchanged lines; real work stays *exactly* proportional. One scale serves a 20 ms trace and a week-long one — no modes, and no logarithmic axis that lies to the eye.

**The causal chain across asynchronous boundaries.** When `create` emits `order-placed` and another flow consumes it moments later, every other system gives you two unrelated traces, because it does not know the relation. We declared it in code, so we join them: parent above, current, children below, expandable in place. This answers the question that is impossible elsewhere — *which HTTP request two hours ago caused this email?* The naming is deliberate: the Flows panel has the causality view, Traces has the causal chain — one law, one vocabulary.

**Spans are coloured by effect tier** — the same visual vocabulary as Flows and the drawer, so a trace dominated by a warning-coloured bar tells you the external provider is the problem, not your database, before you open it.

**List rows** carry an inline mini-waterfall plus the **typed error code**. One row saying `FlightFull` is worth a hundred saying `400`.

**The filter no one else can offer:** filter by effect — everything that wrote `bookings`, asked a model, sent an email, read `STRIPE_KEY`, or cost more than $0.05. Because effects are declared, this is a query rather than a text search.

**Three non-negotiables:** sampling is stated honestly in the list (10% + all errors) with a "trace this flow fully for 10 minutes" escape hatch · the live tail buffers behind a pill instead of moving the ground · Replay is governed by reversibility, offering a dry run when the trace contains an external effect.

**Two questions answered on open:** *why was it slow* — the critical path is highlighted automatically and the rest dims; *why did it fail* — the view opens on the failing span rather than merely colouring it red.
