---
title: "Signals"
description: "Queue depth, in-flight, DLQ, live monitors."
source: "docs/spec/console.md"
---

#### 9.4 Signals

**One list, not three tabs.** Splitting queue, pub/sub and stream into tabs would contradict the thesis that they are one element. The list is grouped by delivery physics; **the detail adapts** — the same pattern as context-adaptive columns.

**The dead-letter queue is why this panel exists.** Every tool shows you dead letters; almost none help you repair them. We hold four things others don't: the schema (payload rendered as an editable form), typed errors, the causal chain that produced the message, and the consumer's declared effects.

**The most valuable line in the panel states whether the consumer is durable.** Durable → replay resumes at the failed step and the card is not charged twice. Not durable → everything re-runs from the beginning. Said at the point of decision, not in documentation. This single line teaches correct architecture, because it makes `durable: true` visibly worth having.

**Bulk repair:** dry run first ("480 would succeed, 20 would still fail"), then replay at a controlled rate so a fix does not become a storm.

**Per-physics detail:** `once` → pending, in-flight, DLQ, retry policy · `broadcast` → per-subscriber lag and errors, with replay targeted at a single subscriber · `live` → connection count, throughput, and a payload monitor with pause/export that auto-pauses on scroll.

**Producers and consumers** are shown as a mini causality view with cross-panel jumps into Flows. **Outbox lag** is surfaced, since `emit` commits with the transaction and then relays. **Orphaned signals** are retained by reconciliation — silently deleting a queue that still holds messages is unacceptable.
