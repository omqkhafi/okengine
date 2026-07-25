---
title: "Gate"
description: "permission to act — Auth, session, ABAC, rate limits, quotas, and feature flags sit at the trigger — permission to act before effects run."
source: "docs/spec/unified-theory.md"
---

Gate is the element for **permission to act**.

Auth, session, ABAC, rate limits, quotas, and feature flags sit at the trigger — permission to act before effects run.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **Gate** | auth · session · ABAC · rate limit · quota · feature flag | permission to act |

## Example from the teaching apps

Claimed fence from **linkly** — same source the doc-drift gate checks:

### `examples/linkly/src/gates.ts`

```typescript
import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const fair = gate.rate({
  strategy: "sliding-window-counter",   // near-exact, two keys, no boundary bursts
  max: 60, per: "1m", keyBy: "ip",
});
```

## Next

- [Vault](/docs/elements/vault)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
