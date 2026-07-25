---
title: "Store"
description: "Browse sql/kv/files/index; cache keys; replica lag."
source: "docs/spec/console.md"
---

#### 9.5 Store

**The most dangerous panel in production.** An external database tool cannot give four guarantees this one must: gates, tenant isolation, PII masking, and audit. That is why we own the data path rather than shelling out to a generic client.

Four facets (`sql · kv · files · index`) with genuinely different interfaces, so: one list grouped by facet, adaptive detail.

**Signature insight — a direct edit is not a flow execution.** Editing a row by hand runs no business logic and emits nothing; it creates a state the system could never have reached. Because we know which flows write the table and what they emit, the confirmation *names what will not happen*: `order-placed` will not be emitted, `booking-confirmed` will not reach the customer. A confirmation carrying information changes the decision; an empty one gets click-through by the third time.

**PII masking follows the schema classification, not column names** — so it survives raw SQL: `SELECT *` leaks nothing. Revealing requires `pii:reveal` and is itself an audited action.

**The tenant selector lives in the header, not among the filters.** Displaying mixed-tenant data in a production console is a compliance breach, not a display bug.

**The cache sub-view** shows which read produced a key and which write will invalidate it — invalidation made visible, which is only possible because it is computed from effects rather than hand-written.

Also here: replica lag, migration drift (declared vs applied), a **read-only by default** SQL console with writes as a separate capability, content-addressed file keys with automatically generated operational warnings (such as non-ASCII object keys breaking signed-URL encoding), and a similarity probe on the index facet for debugging RAG flows.
