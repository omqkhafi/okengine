---
title: "Clock"
description: "Upcoming crons, sleeping durable flows, journal."
source: "docs/spec/console.md"
---

#### 9.6 Clock

Two different things live here: **recurring schedules** and **pending wakes** (durable sleeps and delays). Both are the future, so **the panel looks like time rather than a grid** — a forward timeline, because the element is time.

**The view no one else has: what is the system waiting for.** A list of every sleeping durable flow and when it wakes. Frameworks without journaled execution cannot show this at all; for us it is free, because the journal already knows. "1,204 sleeping — 842 waiting out a trial period, 324 in a payment grace window" is operational insight that does not exist in the market today.

**Cron health is four numbers, not one:** drift (scheduled vs actual), overdue, runs missed while the app was down together with the catch-up policy, and **which instance holds the lease** — since horizontal scaling means several instances and leader election is what stops double execution. Without the lease, nobody can explain why a cron did not fire on the host whose logs they are reading.

**DST ambiguity is detected from the expression and the zone together.** A daily 02:00 job in a DST-observing zone runs twice or never on transition days. The warning appears only when the schedule actually falls in the ambiguous window — a warning that always shows becomes background texture everyone ignores.

Actions: run now, wake early, pause, and edit the schedule where `overridable`. "Run now" on a cron with an external effect carries the same irreversibility friction as everywhere else.
