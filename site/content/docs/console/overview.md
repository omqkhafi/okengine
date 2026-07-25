---
title: "Overview"
description: "Is the system healthy right now?"
source: "docs/spec/console.md"
---

#### 9.16 Overview

**Overview is where dashboards go to die**: a wall of charts nobody reads, which never answers "is the system fine?" and never says what to do. The research on this is unambiguous — error budget and burn rate belong *above* latency histograms; supporting metrics add context, objectives anchor the conversation. And most dashboards are organised by architecture, which suits engineers and misses customers.

**So the panel is built on declared objectives**, which suits us because we declare everything else:

```typescript
on(http.post("/bookings").gate(member), flow({
  slo: { availability: "99.9%", latency: { p99: "200ms" } },
}))
```

The objective enters the Manifest — and that has a consequence nobody has exploited. A documented failure mode of SLO practice is teams quietly lowering targets to avoid planning pressure and adding exclusions after every incident until the objective becomes reputation management. **Here, lowering a target is a code change that passes through Manifest Diff and team review** rather than a silent dashboard edit.

**Burn rate, not raw thresholds.** Burn rate is the current error rate divided by the tolerable one; Google's workbook uses 14.4× over one hour as page-immediately and 6× over six hours as investigate-but-do-not-wake-anyone. A single threshold ("error rate above 1% for five minutes") fires too early or too late, because a transient spike is indistinguishable from the opening of a real incident.

**Journeys, not services.** Forty services at 99.9% in sequence yield 96.1% for the user — an expectation that cannot mathematically be met. Because we hold the causal chain, a journey is declarable, and **the compiler rejects the impossible**: "this path composes to 99.4% but declares 99.5%." A mathematical error caught before deploy instead of six months into a promise.

**Overview invents no metrics.** Every panel produces findings — unguarded flows, dead letters, overdue crons, dormant secrets, spam complaints, model budget overruns, architecture cycles, plugin capability widening — and Overview is their **ranked union**. The ranking is principled: user harm first, then irreversibility, then trend.

**Two budgets, not one.** Cost is a first-class effect here, so it takes exactly the same mental model: declared budget, burn rate, projected exhaustion. Reliability budget and money budget side by side, learned once and read twice — something no console offers today and every model-era backend needs.

**And the panel audits itself against dashboard theatre.** If an objective never burns, never guides a decision, and nobody would behave differently if it did, it should be retired. So an SLO that has not burned in ninety days is marked **ceremonial**, and growth in exclusions is tracked and shown. On day one, with no objectives declared, the panel shows findings and golden signals and invites you to declare your first objective on your busiest flow.

---
