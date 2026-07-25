---
title: "Tenancy"
description: "Per-tenant usage, limits, isolation checks (conditional)."
source: "docs/spec/console.md"
---

### 9. Panel catalog

Navigation mirrors the eight elements, with cross-cutting panels below them.

| # | Panel | Answers | Dev | Prod |
|---|---|---|---|---|
| 0 | **Overview** | is the system healthy right now? | ✓ | ✓ |
| 1 | **Flows** | what exists; call it; read its contract | full + source links | read + invoke per gates |
| 2 | **Signals** | queue depth, in-flight, DLQ, live monitors | full | replay/purge per gates |
| 3 | **Store** | browse sql/kv/files/index; cache keys; replica lag | full + Studio link | masked, gated, audited |
| 4 | **Clock** | upcoming crons, sleeping durable flows, journal | full | trigger/pause; edit if `overridable` |
| 5 | **Gates** | permission matrix, rate counters, MFA map | full | limits if `overridable` |
| 6 | **Vault** | secret contracts, who can read each, rotation due | full | set/rotate only, never reveal |
| 7 | **Channels** | templates, delivery receipts, bounces, opt-outs, deliverability (SPF/DKIM/DMARC) | full + console inbox | send test, inspect delivery |
| 8 | **AI** | prompt versions, eval scores, cost, agent runs | full | read + budgets |
| 9 | **Architecture** | how it all connects — the diagram that *is* the code | ✓ | ✓ |
| 10 | **Traces** | one timeline across http → store → signal → durable steps | ✓ | ✓ |
| 11 | **Runs** | wide events — one record per flow execution, queried by dimension | ✓ | ✓ |
| 12 | **Manifest Diff** | blast radius of a deploy: new effects, widened permissions | ✓ | ✓ |
| 13 | **Access** | identities, roles, API keys | ✓ | ✓ (admin) |
| 14 | **Plugins** | installed plugins and their contributed panels | ✓ | ✓ |
| 15 | **Privacy** *(conditional)* | where PII lives, who touches it, export/erase | ✓ | ✓ |
| 16 | **Tenancy** *(conditional)* | per-tenant usage, limits, isolation checks | ✓ | ✓ |

---


## Tenancy

| # | Panel | Answers | Dev | Prod |
|---|---|---|---|---|
| 16 | **Tenancy** *(conditional)* | per-tenant usage, limits, isolation checks | ✓ | ✓ |


This panel is **conditional** — it appears when the optional core plugin is plugged. The panel catalog above is the durable reference; there is no separate detailed subsection in the Console specification beyond that row.
