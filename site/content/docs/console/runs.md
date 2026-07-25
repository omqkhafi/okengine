---
title: "Runs"
description: "Wide events — one record per flow execution."
source: "docs/spec/console.md"
---

#### 9.11 Runs

**The Logs panel was scrapped.** A structured log viewer — however good — is observability 1.0 done well, and the frontier moved. The industry shift is from three signal types toward **wide events**: one record per unit of work carrying dozens of dimensions as queryable fields, with metrics, logs and traces becoming three *views* of one stream rather than three stores populated independently. The decisive difference is that context is injected at **write** time instead of being reassembled from separate signals at **read** time.

**Why this suits okengine uniquely.** The standing complaint about wide events is that they demand discipline: OpenTelemetry does not decide what to record, and if you do not manually attach the user tier, the cart value or the feature-flag state, nothing will. Our effect system removes that burden. Every flow *is* a unit of work, and the compiler already knows what it reads, writes, emits, sends and asks; everything passes through `fx`. So the run carries — with no instrumentation whatsoever — unit, trigger, gates evaluated, tenant, plane, principal, cache hit/miss, replica and lag, cost, prompt version, build version, typed error, and effects. **Everyone else needs human discipline to get wide events; we get them from the architecture.**

**The unification.** One flow execution = one wide event = one span. A trace is a causal chain of runs. Therefore **Runs, Traces and Overview are three views of a single store**, and there is no separate metrics store at all.

**The panel is analysis, not search.** No text box. Instead: query by dimension (`flow = X AND cache = miss AND duration > 1s`), group-by with aggregates, and a distribution view — because you are looking at populations, not lines.

**The signature feature is automatic outlier explanation.** Select the slow region of the distribution and the system compares every dimension between the slow population and the rest: "94% cache=miss vs 6%, 88% replica lag > 200ms vs 2%, 71% tenant=org_a41 vs 14%." The third line is the point — nobody asked about tenants; the system surfaced it because it compares *all* dimensions. That is observability's actual definition: asking questions you did not know you would need. Other tools can do this only over fields a human remembered to attach; ours are declared and typed.

**`fx.log` lines become a field on the run, not a parallel stream** — which kills the "twenty scattered lines you must reassemble yourself" anti-pattern at its root.

##### Storage tiers

| Driver | When | Note |
|---|---|---|
| `files` (Parquet + DuckDB) | **default everywhere, including development** | columnar, ~99% compression, no extra service, runs inside Bun |
| `postgres` | optional | for teams who want a single store and accept the ceiling |
| `clickhouse` | optional, at scale | sub-second over billions of rows; Apache-2.0, so it fits the licence stance |

Using the same engine in development and production means a query written while debugging locally is the same query that runs against production, and a developer can load a year of synthetic runs on a laptop without provisioning anything.

Protocol-named as everywhere else — swapping tiers changes a config line, not code.

##### Lifecycle: retain by default, delete only for compliance

An earlier draft of this spec described an archive → delete → recall pipeline. That was wrong, and the reasoning that removed it is worth recording: **if the same engine queries Parquet on object storage directly, tiering never makes data unavailable — so deletion stops being a maintenance necessity and recall stops being part of the normal path.**

What survives is much smaller:

```typescript
runs: {
  redact: { pii: "90d" },   // compliance: minimise personal data
  keep:   "forever",        // the default; set a duration only if you must
}
```

- **The user never declares an archive.** Locality is an engine detail: recent partitions sit local, older ones on object storage, and both answer the same SQL. Making people reason about tiers is leaking an optimisation into the API.
- **Deletion is a compliance action, not a cleanup job.** Storage is cheap enough that "keep everything" is the honest default; a retention limit exists because PDPL and GDPR require personal data *not* to be kept longer than necessary, not because a disk is filling.
- **Redaction becomes the primary lifecycle action.** Because fields carry the schema's classification, personal data is scrubbed from old partitions on schedule while operational dimensions survive — you can still analyse last year's latency without still holding last year's people.
- **Recall is demoted to a rare performance optimisation** — worth it only for sustained interactive investigation over old data, never for a single question.
- **Legal hold** freezes both redaction and deletion for a filtered subset during a dispute, overriding the policy until lifted.
- **Retention changes still pass through Manifest Diff**, since shortening a window destroys data and deserves a blast-radius warning and a CI gate.

**The honest hard part: erasure from immutable columnar files.** A right-to-erasure request cannot surgically remove one subject's rows from Parquet without rewriting whole partitions. The answer is **crypto-shredding**: personal fields are encrypted with a per-subject key held in the Vault, and erasure deletes the key rather than the bytes. The archived data becomes permanently unreadable, terabytes are never rewritten, and the guarantee is cryptographic rather than procedural. `oke privacy erase --subject <id>` performs exactly this.

The same facility governs the durable-execution journal and channel delivery records — it is a general capability, not a Runs-only feature.
